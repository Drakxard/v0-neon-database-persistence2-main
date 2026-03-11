import { neon } from "@neondatabase/serverless"
import { NextResponse } from "next/server"

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

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const entryId = Number.parseInt(id, 10)
    if (!Number.isInteger(entryId)) {
      return NextResponse.json({ error: "Invalid entry id" }, { status: 400 })
    }

    const body = await request.json()
    const answerText = typeof body.answerText === "string" ? body.answerText.trim() : null

    const rows = await sql`
      UPDATE subject_day_entries
      SET answer_text = ${answerText}, updated_at = NOW()
      WHERE id = ${entryId}
      RETURNING id, subject_id, week_number, session_date, weekday_index, order_index, transcript_text, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, answer_text, created_at, updated_at
    `

    if (!rows[0]) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 })
    }

    return NextResponse.json(rows[0])
  } catch (error) {
    console.error("PATCH /api/subject-day-entries/[id] error:", error)
    if (isMissingSubjectDayEntriesTable(error)) {
      return NextResponse.json(
        { error: "Falta crear la tabla subject_day_entries. Ejecuta scripts/005-create-subject-day-entries.sql en Neon." },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: "Failed to update entry" }, { status: 500 })
  }
}
