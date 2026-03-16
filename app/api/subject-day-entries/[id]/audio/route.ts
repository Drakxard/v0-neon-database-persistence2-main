import { neon } from "@neondatabase/serverless"

import { downloadDriveFile } from "@/lib/google-drive"
import { downloadR2Object, isR2ObjectKey } from "@/lib/r2"

export const runtime = "nodejs"

const sql = neon(process.env.DATABASE_URL!)

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
    const { id } = await context.params
    const entryId = Number.parseInt(id, 10)
    if (!Number.isInteger(entryId)) {
      return Response.json({ error: "Invalid entry id" }, { status: 400 })
    }

    const rows = await sql`
      SELECT drive_file_id, drive_file_name, drive_mime_type
      FROM subject_day_entries
      WHERE id = ${entryId}
      LIMIT 1
    `
    const entry = rows[0]
    if (!entry) {
      return Response.json({ error: "Entry not found" }, { status: 404 })
    }

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
    const message = error instanceof Error ? error.message : "Failed to stream audio"
    return Response.json({ error: message }, { status: 500 })
  }
}
