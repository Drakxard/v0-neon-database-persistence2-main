import { neon } from "@neondatabase/serverless"
import { requireSql } from "@/lib/db"
import { NextResponse } from "next/server"

import { requireAuthSession } from "@/lib/authz"
import {
  CRONOGRAMA_RESOURCE_TYPE,
  isMissingCronogramaTable,
  normalizeCronogramaEmail,
  normalizeCronogramaRecord,
  normalizeUploadedPdfFileName,
  type UserCronogramaRow,
} from "@/lib/cronograma"
import { readCronogramaManifest, saveCronogramaManifest } from "@/lib/local-r2-manifests"
import { deleteR2Object, getR2ObjectMetadata, isR2ObjectKey } from "@/lib/r2"
import { isLocalStorageMode } from "@/lib/storage-mode"

export const runtime = "nodejs"

const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

function readMetadataValue(metadata: Record<string, string> | undefined, key: string) {
  return String(metadata?.[key] || "").trim()
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const payload = await request.json()
    const driveFileId = String(payload?.driveFileId || "").trim()
    const requestedFileName = normalizeUploadedPdfFileName(String(payload?.fileName || ""))
    if (!driveFileId) {
      return badRequest("Missing driveFileId")
    }
    if (!isR2ObjectKey(driveFileId)) {
      return badRequest("Cronograma must be stored in R2")
    }

    const email = normalizeCronogramaEmail(auth.session!.email)
    const remoteFile = await getR2ObjectMetadata(driveFileId)
    if (remoteFile.mimeType !== "application/pdf") {
      return badRequest("Only PDF files are allowed")
    }

    const metadataEmail = normalizeCronogramaEmail(readMetadataValue(remoteFile.metadata, "owner-email"))
    const metadataResourceType = readMetadataValue(remoteFile.metadata, "resource-type")
    if (metadataEmail && metadataEmail !== email) {
      return badRequest("La metadata del archivo no coincide con el usuario autenticado")
    }
    if (metadataResourceType && metadataResourceType !== CRONOGRAMA_RESOURCE_TYPE) {
      return badRequest("La metadata del archivo no corresponde a un cronograma")
    }

    const fileName =
      normalizeUploadedPdfFileName(readMetadataValue(remoteFile.metadata, "original-file-name")) ||
      requestedFileName ||
      normalizeUploadedPdfFileName(remoteFile.name)
    if (!fileName) {
      return badRequest("Missing fileName for uploaded cronograma")
    }

    if (isLocalStorageMode()) {
      const previous = await readCronogramaManifest()
      const manifest = await saveCronogramaManifest({
        version: 1,
        fileName,
        driveFileId,
        driveMimeType: remoteFile.mimeType,
        updatedAt: new Date().toISOString(),
      })

      if (previous?.driveFileId && previous.driveFileId !== driveFileId) {
        try {
          await deleteR2Object(previous.driveFileId)
        } catch (error) {
          console.warn("POST /api/cronograma/complete local cleanup warning:", error)
        }
      }

      return NextResponse.json({
        fileName: manifest.fileName,
        driveFileId: manifest.driveFileId,
        driveMimeType: manifest.driveMimeType,
        updatedAt: manifest.updatedAt,
      })
    }

    const previousRows = await requireSql(sql)`
      SELECT email, file_name, drive_file_id, drive_mime_type, created_at, updated_at
      FROM user_cronograma_pdfs
      WHERE email = ${email}
      LIMIT 1
    ` as UserCronogramaRow[]
    const previousRow = previousRows[0] ?? null

    const rows = await requireSql(sql)`
      INSERT INTO user_cronograma_pdfs (
        email,
        file_name,
        drive_file_id,
        drive_mime_type
      )
      VALUES (
        ${email},
        ${fileName},
        ${driveFileId},
        ${remoteFile.mimeType}
      )
      ON CONFLICT (email) DO UPDATE
      SET
        file_name = EXCLUDED.file_name,
        drive_file_id = EXCLUDED.drive_file_id,
        drive_mime_type = EXCLUDED.drive_mime_type,
        updated_at = NOW()
      RETURNING email, file_name, drive_file_id, drive_mime_type, created_at, updated_at
    ` as UserCronogramaRow[]

    if (previousRow?.drive_file_id && previousRow.drive_file_id !== driveFileId) {
      try {
        await deleteR2Object(previousRow.drive_file_id)
      } catch (error) {
        console.warn("POST /api/cronograma/complete remote cleanup warning:", error)
      }
    }

    return NextResponse.json(normalizeCronogramaRecord(rows[0] ?? null))
  } catch (error) {
    console.error("POST /api/cronograma/complete error:", error)
    if (isMissingCronogramaTable(error)) {
      return NextResponse.json(
        { error: "Falta crear la tabla user_cronograma_pdfs. Ejecuta scripts/028-create-user-cronograma-pdfs.sql en Neon." },
        { status: 503 }
      )
    }

    const message = error instanceof Error ? error.message : "Failed to complete cronograma upload"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
