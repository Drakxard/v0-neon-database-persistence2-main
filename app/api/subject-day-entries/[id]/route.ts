import { neon } from "@neondatabase/serverless"
import { NextResponse } from "next/server"

export const runtime = "nodejs"

const sql = neon(process.env.DATABASE_URL!)

type EntryRow = {
  id: number
  subject_id: string
  week_number: number
  session_date: string
  weekday_index: number
  order_index: number
  transcript_text: string
  drive_file_id: string
  drive_file_name: string
  drive_mime_type: string
  drive_web_view_link: string
  answer_text: string | null
  custom_title: string | null
  practice_state: "erre" | null
  created_at: string
  updated_at: string
}

function isMissingSubjectDayEntriesTable(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "42P01"
  )
}

function getDisplayTitle(entry: Pick<EntryRow, "custom_title" | "order_index">) {
  const customTitle = entry.custom_title?.trim()
  return customTitle && customTitle.length > 0 ? customTitle : `Duda ${entry.order_index + 1}`
}

async function withLinks(row: EntryRow | null) {
  if (!row) return null

  const links = await sql`
    SELECT id, label, url
    FROM subject_day_entry_links
    WHERE entry_id = ${row.id}
    ORDER BY order_index ASC, id ASC
  `

  return {
    ...row,
    display_title: getDisplayTitle(row),
    external_links: links,
  }
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
    const customTitle = typeof body.customTitle === "string" ? body.customTitle.trim() : null
    const practiceState =
      body.practiceState === "erre" ? "erre" : body.practiceState === null ? null : undefined

    const rows = await sql`
      UPDATE subject_day_entries
      SET
        answer_text = CASE WHEN ${"answerText" in body} THEN ${answerText} ELSE answer_text END,
        custom_title = CASE WHEN ${"customTitle" in body} THEN ${customTitle} ELSE custom_title END,
        practice_state = CASE WHEN ${practiceState !== undefined} THEN ${practiceState ?? null} ELSE practice_state END,
        updated_at = NOW()
      WHERE id = ${entryId}
      RETURNING id, subject_id, week_number, session_date, weekday_index, order_index, transcript_text, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, answer_text, custom_title, practice_state, created_at, updated_at
    `

    if (!rows[0]) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 })
    }

    return NextResponse.json(await withLinks(rows[0] as EntryRow))
  } catch (error) {
    console.error("PATCH /api/subject-day-entries/[id] error:", error)
    if (isMissingSubjectDayEntriesTable(error)) {
      return NextResponse.json(
        { error: "Falta crear la tabla subject_day_entries. Ejecuta scripts/005-create-subject-day-entries.sql y scripts/006-add-subject-day-entry-metadata.sql en Neon." },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: "Failed to update entry" }, { status: 500 })
  }
}
