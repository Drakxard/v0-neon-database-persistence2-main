import { neon } from "@neondatabase/serverless"
import { NextResponse } from "next/server"

import { requireAuthSession } from "@/lib/authz"
import {
  buildCronogramaObjectKey,
  CRONOGRAMA_RESOURCE_TYPE,
  isMissingCronogramaTable,
  looksLikePdf,
  normalizeCronogramaEmail,
  normalizeCronogramaRecord,
  normalizeUploadedPdfFileName,
  type UserCronogramaRow,
} from "@/lib/cronograma"
import { deleteR2Object, uploadR2Object } from "@/lib/r2"

export const runtime = "nodejs"

const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const email = normalizeCronogramaEmail(auth.session!.email)
    const currentRows = await sql`
      SELECT email, file_name, drive_file_id, drive_mime_type, created_at, updated_at
      FROM user_cronograma_pdfs
      WHERE email = ${email}
      LIMIT 1
    ` as UserCronogramaRow[]
    const currentRow = currentRows[0] ?? null

    const formData = await request.formData()
    const fileEntry = formData.get("file")
    if (!(fileEntry instanceof File)) {
      return badRequest("Missing file")
    }

    const mimeType = String(fileEntry.type || "").trim() || "application/pdf"
    if (mimeType !== "application/pdf") {
      return badRequest("Only PDF files are allowed")
    }

    const requestedFileName = normalizeUploadedPdfFileName(String(formData.get("fileName") || ""))
    const nextFileName = requestedFileName || normalizeUploadedPdfFileName(currentRow?.file_name || "") || "cronograma.pdf"
    const objectKey = buildCronogramaObjectKey({
      email,
      fileName: nextFileName,
    })

    const pdfBuffer = Buffer.from(await fileEntry.arrayBuffer())
    if (pdfBuffer.byteLength === 0) {
      return badRequest("El PDF recibido esta vacio.")
    }
    if (!looksLikePdf(pdfBuffer)) {
      return badRequest("El archivo recibido no es un PDF valido.")
    }

    await uploadR2Object({
      objectKey,
      mimeType,
      body: pdfBuffer,
      metadata: {
        "owner-email": email,
        "original-file-name": nextFileName,
        "resource-type": CRONOGRAMA_RESOURCE_TYPE,
      },
    })

    const rows = await sql`
      INSERT INTO user_cronograma_pdfs (
        email,
        file_name,
        drive_file_id,
        drive_mime_type
      )
      VALUES (
        ${email},
        ${nextFileName},
        ${objectKey},
        ${mimeType}
      )
      ON CONFLICT (email) DO UPDATE
      SET
        file_name = EXCLUDED.file_name,
        drive_file_id = EXCLUDED.drive_file_id,
        drive_mime_type = EXCLUDED.drive_mime_type,
        updated_at = NOW()
      RETURNING email, file_name, drive_file_id, drive_mime_type, created_at, updated_at
    ` as UserCronogramaRow[]

    if (currentRow?.drive_file_id && currentRow.drive_file_id !== objectKey) {
      try {
        await deleteR2Object(currentRow.drive_file_id)
      } catch (error) {
        console.warn("POST /api/cronograma/sync remote cleanup warning:", error)
      }
    }

    return NextResponse.json(normalizeCronogramaRecord(rows[0] ?? null))
  } catch (error) {
    console.error("POST /api/cronograma/sync error:", error)
    if (isMissingCronogramaTable(error)) {
      return NextResponse.json(
        { error: "Falta crear la tabla user_cronograma_pdfs. Ejecuta scripts/028-create-user-cronograma-pdfs.sql en Neon." },
        { status: 503 }
      )
    }

    const message = error instanceof Error ? error.message : "Failed to sync cronograma"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
