import { getLegacyDatabase } from "@/lib/db"
import { requireSql } from "@/lib/db"

import { downloadDriveFile } from "@/lib/google-drive"
import { findLocalEntryById } from "@/lib/local-r2-manifests"
import { isRemoteFileNotFoundError, isRemoteProviderAuthError } from "@/lib/remote-file-errors"
import { downloadR2Object, isR2ObjectKey } from "@/lib/r2"
import { isLocalStorageMode } from "@/lib/storage-mode"
import { ensureSubjectAccess, requireAuthSession } from "@/lib/authz"

export const runtime = "nodejs"

const sql = getLegacyDatabase()

function isMissingSubjectDayEntriesTable(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "42P01"
  )
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const { id } = await context.params
    const entryId = Number.parseInt(id, 10)
    if (!Number.isInteger(entryId)) {
      return Response.json({ error: "Invalid entry id" }, { status: 400 })
    }

    if (isLocalStorageMode()) {
      const entry = await findLocalEntryById(entryId)
      if (!entry) {
        return Response.json({ error: "Entry not found" }, { status: 404 })
      }

      const forbidden = ensureSubjectAccess(auth.session!, entry.subject_id)
      if (forbidden) return forbidden

      const file = isR2ObjectKey(entry.drive_file_id)
        ? await downloadR2Object(entry.drive_file_id)
        : await downloadDriveFile(entry.drive_file_id)

      return new Response(file.buffer, {
        headers: {
          "Content-Type": file.mimeType || entry.drive_mime_type || "audio/webm",
          "Content-Disposition": `inline; filename="${entry.drive_file_name}"`,
          "Cache-Control": "private, max-age=0, must-revalidate",
        },
      })
    }

    const rows = await requireSql(sql)`
      SELECT drive_file_id, drive_file_name, drive_mime_type, subject_id
      FROM subject_day_entries
      WHERE id = ${entryId}
      LIMIT 1
    `
    const entry = rows[0]
    if (!entry) {
      return Response.json({ error: "Entry not found" }, { status: 404 })
    }

    const forbidden = ensureSubjectAccess(auth.session!, String(entry.subject_id || ""))
    if (forbidden) return forbidden

    const file = isR2ObjectKey(entry.drive_file_id)
      ? await downloadR2Object(entry.drive_file_id)
      : await downloadDriveFile(entry.drive_file_id)

    return new Response(file.buffer, {
      headers: {
        "Content-Type": file.mimeType || entry.drive_mime_type || "audio/webm",
        "Content-Disposition": `inline; filename="${entry.drive_file_name}"`,
        "Cache-Control": "private, max-age=0, must-revalidate",
      },
    })
  } catch (error) {
    console.error("GET /api/subject-day-entries/[id]/audio error:", error)
    if (isMissingSubjectDayEntriesTable(error)) {
      return Response.json(
        { error: "Falta crear la tabla subject_day_entries. Ejecuta scripts/005-create-subject-day-entries.sql en Neon." },
        { status: 503 }
      )
    }
    if (isRemoteFileNotFoundError(error) && error.provider === "drive") {
      return Response.json(
        { error: "El audio heredado no esta disponible en Google Drive. Requiere migracion o reautorizacion." },
        { status: 424 }
      )
    }
    if (isRemoteProviderAuthError(error) && error.provider === "drive") {
      return Response.json(
        { error: "El audio heredado no esta disponible en Google Drive. Requiere migracion o reautorizacion." },
        { status: 424 }
      )
    }
    const message = error instanceof Error ? error.message : "Failed to stream audio"
    return Response.json({ error: message }, { status: 500 })
  }
}
