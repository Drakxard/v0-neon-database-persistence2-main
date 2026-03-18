import { neon } from "@neondatabase/serverless"
import { NextResponse } from "next/server"

import { deleteDriveFile } from "@/lib/google-drive"
import { deleteR2Object, isR2ObjectKey } from "@/lib/r2"

export const runtime = "nodejs"

const sql = neon(process.env.DATABASE_URL!)

type EntryRow = {
  id: number
  subject_day_material_id: number | null
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
  is_featured: boolean
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

function isMissingColumn(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "42703"
  )
}

function getDisplayTitle(entry: Pick<EntryRow, "custom_title" | "order_index">) {
  const customTitle = entry.custom_title?.trim()
  return customTitle && customTitle.length > 0 ? customTitle : `Duda ${entry.order_index + 1}`
}

function normalizeSessionDateKey(sessionDate: string | Date) {
  if (sessionDate instanceof Date) {
    return `${sessionDate.getFullYear()}-${String(sessionDate.getMonth() + 1).padStart(2, "0")}-${String(sessionDate.getDate()).padStart(2, "0")}`
  }

  return sessionDate.includes("T") ? sessionDate.slice(0, 10) : sessionDate
}

async function withLinks(row: EntryRow | null) {
  if (!row) return null

  let links: { id: number; label: string; url: string }[]
  try {
    links = await sql`
      SELECT id, label, url
      FROM subject_day_entry_links
      WHERE entry_id = ${row.id}
      ORDER BY order_index ASC, id ASC
    ` as { id: number; label: string; url: string }[]
  } catch (error) {
    if (isMissingSubjectDayEntriesTable(error)) {
      links = []
    } else {
      throw error
    }
  }

  return {
    ...row,
    session_date: normalizeSessionDateKey(row.session_date),
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
    const transcriptText = typeof body.transcriptText === "string" ? body.transcriptText.trim() : null
    const customTitle = typeof body.customTitle === "string" ? body.customTitle.trim() : null
    const practiceState =
      body.practiceState === "erre" ? "erre" : body.practiceState === null ? null : undefined
    const isFeatured = typeof body.isFeatured === "boolean" ? body.isFeatured : undefined

    let rows: EntryRow[]
    try {
      rows = await sql`
        WITH entry_scope AS (
          SELECT subject_id, week_number, session_date
          FROM subject_day_entries
          WHERE id = ${entryId}
        ),
        cleared AS (
          UPDATE subject_day_entries
          SET is_featured = FALSE
          WHERE ${isFeatured === true}
            AND (subject_id, week_number, session_date) IN (
              SELECT subject_id, week_number, session_date
              FROM entry_scope
            )
          RETURNING id
        )
        UPDATE subject_day_entries
        SET
          transcript_text = CASE WHEN ${"transcriptText" in body} THEN ${transcriptText || ""} ELSE transcript_text END,
          answer_text = CASE WHEN ${"answerText" in body} THEN ${answerText} ELSE answer_text END,
          custom_title = CASE WHEN ${"customTitle" in body} THEN ${customTitle} ELSE custom_title END,
          practice_state = CASE WHEN ${practiceState !== undefined} THEN ${practiceState ?? null} ELSE practice_state END,
          is_featured = CASE WHEN ${isFeatured !== undefined} THEN ${isFeatured} ELSE is_featured END,
          updated_at = NOW()
        WHERE id = ${entryId}
        RETURNING id, subject_day_material_id, subject_id, week_number, session_date, weekday_index, order_index, transcript_text, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, answer_text, custom_title, practice_state, is_featured, created_at, updated_at
      ` as EntryRow[]
    } catch (error) {
      const isTryingNewFields = "customTitle" in body || practiceState !== undefined || isFeatured !== undefined
      if (!isMissingColumn(error) || isTryingNewFields) {
        throw error
      }

      rows = await sql`
        UPDATE subject_day_entries
        SET
          transcript_text = CASE WHEN ${"transcriptText" in body} THEN ${transcriptText || ""} ELSE transcript_text END,
          answer_text = CASE WHEN ${"answerText" in body} THEN ${answerText} ELSE answer_text END,
          updated_at = NOW()
        WHERE id = ${entryId}
        RETURNING id, NULL::INTEGER AS subject_day_material_id, subject_id, week_number, session_date, weekday_index, order_index, transcript_text, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, answer_text, NULL::TEXT AS custom_title, NULL::TEXT AS practice_state, FALSE AS is_featured, created_at, updated_at
      ` as EntryRow[]
    }

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
    if (isMissingColumn(error)) {
      return NextResponse.json(
        { error: "Falta ejecutar scripts/006-add-subject-day-entry-metadata.sql en Neon para usar esta funcion." },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: "Failed to update entry" }, { status: 500 })
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const entryId = Number.parseInt(id, 10)
    if (!Number.isInteger(entryId)) {
      return NextResponse.json({ error: "Invalid entry id" }, { status: 400 })
    }

    const entries = await sql`
      SELECT id, drive_file_id
      FROM subject_day_entries
      WHERE id = ${entryId}
    ` as Array<{ id: number; drive_file_id: string }>

    const entry = entries[0]
    if (!entry) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 })
    }

    if (entry.drive_file_id) {
      if (isR2ObjectKey(entry.drive_file_id)) {
        await deleteR2Object(entry.drive_file_id)
      } else {
        await deleteDriveFile(entry.drive_file_id)
      }
    }

    const rows = await sql`
      DELETE FROM subject_day_entries
      WHERE id = ${entryId}
      RETURNING id
    ` as Array<{ id: number }>

    return NextResponse.json({ success: true, id: rows[0].id })
  } catch (error) {
    console.error("DELETE /api/subject-day-entries/[id] error:", error)
    if (isMissingSubjectDayEntriesTable(error)) {
      return NextResponse.json(
        { error: "Falta crear la tabla subject_day_entries. Ejecuta scripts/005-create-subject-day-entries.sql y scripts/006-add-subject-day-entry-metadata.sql en Neon." },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: "Failed to delete entry" }, { status: 500 })
  }
}
