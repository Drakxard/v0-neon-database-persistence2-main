import { neon } from "@neondatabase/serverless"

import { requireAuthSession } from "@/lib/authz"
import {
  isMissingCronogramaTable,
  normalizeCronogramaEmail,
  type UserCronogramaRow,
} from "@/lib/cronograma"
import { readCronogramaManifest } from "@/lib/local-r2-manifests"
import { isRemoteFileNotFoundError } from "@/lib/remote-file-errors"
import { downloadR2Object } from "@/lib/r2"
import { isLocalStorageMode } from "@/lib/storage-mode"

export const runtime = "nodejs"

const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null

export async function GET() {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    if (isLocalStorageMode()) {
      const manifest = await readCronogramaManifest()
      if (!manifest) {
        return Response.json({ error: "Cronograma not found" }, { status: 404 })
      }

      const file = await downloadR2Object(manifest.driveFileId)
      return new Response(file.buffer, {
        headers: {
          "Content-Type": file.mimeType || manifest.driveMimeType || "application/pdf",
          "Content-Disposition": `inline; filename="${manifest.fileName}"`,
          "Cache-Control": "private, max-age=0, must-revalidate",
        },
      })
    }

    const email = normalizeCronogramaEmail(auth.session!.email)
    const rows = await sql`
      SELECT email, file_name, drive_file_id, drive_mime_type, created_at, updated_at
      FROM user_cronograma_pdfs
      WHERE email = ${email}
      LIMIT 1
    ` as UserCronogramaRow[]

    const row = rows[0] ?? null
    if (!row) {
      return Response.json({ error: "Cronograma not found" }, { status: 404 })
    }

    try {
      const file = await downloadR2Object(row.drive_file_id)
      return new Response(file.buffer, {
        headers: {
          "Content-Type": file.mimeType || row.drive_mime_type || "application/pdf",
          "Content-Disposition": `inline; filename="${row.file_name}"`,
          "Cache-Control": "private, max-age=0, must-revalidate",
        },
      })
    } catch (error) {
      if (isRemoteFileNotFoundError(error)) {
        await sql`
          DELETE FROM user_cronograma_pdfs
          WHERE email = ${email}
        `
        return Response.json({ error: "El archivo remoto del cronograma ya no existe." }, { status: 404 })
      }

      throw error
    }
  } catch (error) {
    console.error("GET /api/cronograma/file error:", error)
    if (isMissingCronogramaTable(error)) {
      return Response.json(
        { error: "Falta crear la tabla user_cronograma_pdfs. Ejecuta scripts/028-create-user-cronograma-pdfs.sql en Neon." },
        { status: 503 }
      )
    }

    const message = error instanceof Error ? error.message : "Failed to stream cronograma"
    return Response.json({ error: message }, { status: 500 })
  }
}
