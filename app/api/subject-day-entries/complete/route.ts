import { neon } from "@neondatabase/serverless"
import { NextResponse } from "next/server"

import { transcribeAudioWithGemini } from "@/lib/gemini"
import { downloadDriveFile, getDriveFileMetadata } from "@/lib/google-drive"
import { getWeekNumberForDate, getWeekdayIndexFromDateKey, parseDateKey } from "@/lib/subject-utils"

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

function isGeminiQuotaError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "")
  return message.toLowerCase().includes("quota exceeded")
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

function parseSessionDate(sessionDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) return null
  const parsed = parseDateKey(sessionDate)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
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

function formatEntry(row: EntryRow) {
  return {
    ...row,
    session_date: normalizeSessionDateKey(row.session_date),
    display_title: getDisplayTitle(row),
    external_links: [],
  }
}

export async function POST(request: Request) {
  try {
    const payload = await request.json()
    const subjectId = String(payload?.subjectId || "").trim()
    const sessionDate = String(payload?.sessionDate || "").trim()
    const parsedSessionDate = parseSessionDate(sessionDate)
    const requestedWeekNumber = Number.parseInt(String(payload?.weekNumber || ""), 10)
    const rawMaterialId = Number.parseInt(String(payload?.materialId || ""), 10)
    const materialId = Number.isNaN(rawMaterialId) ? null : rawMaterialId
    const driveFileId = String(payload?.driveFileId || "").trim()

    if (!subjectId || !sessionDate || !parsedSessionDate || !driveFileId) {
      return badRequest("Missing completion metadata")
    }

    const driveFile = await getDriveFileMetadata(driveFileId)
    if (!driveFile.mimeType.startsWith("audio/")) {
      return badRequest("Invalid audio mime type")
    }

    const derivedWeekNumber = getWeekNumberForDate(parsedSessionDate)
    const weekNumber =
      Number.isNaN(requestedWeekNumber) || requestedWeekNumber !== derivedWeekNumber ? derivedWeekNumber : requestedWeekNumber
    const weekdayIndex = getWeekdayIndexFromDateKey(sessionDate)

    const [countRow] = await sql`
      SELECT COALESCE(MAX(order_index), -1) AS max_order
      FROM subject_day_entries
      WHERE subject_id = ${subjectId}
        AND week_number = ${weekNumber}
        AND session_date = ${sessionDate}
        AND (
          (${materialId}::INTEGER IS NULL AND subject_day_material_id IS NULL)
          OR subject_day_material_id = ${materialId}
        )
    `
    const nextOrderIndex = Number(countRow?.max_order ?? -1) + 1

    let transcriptText = "Transcripcion pendiente."
    try {
      const downloadedFile = await downloadDriveFile(driveFile.id)
      transcriptText = await transcribeAudioWithGemini({
        audioBuffer: downloadedFile.buffer,
        mimeType: downloadedFile.mimeType || driveFile.mimeType,
      })
    } catch (error) {
      console.error("Gemini transcription failed, keeping pending placeholder:", error)
      if (!isGeminiQuotaError(error)) {
        throw error
      }
    }

    let rows: EntryRow[]
    try {
      rows = await sql`
        INSERT INTO subject_day_entries (
          subject_id,
          subject_day_material_id,
          week_number,
          session_date,
          weekday_index,
          order_index,
          transcript_text,
          drive_file_id,
          drive_file_name,
          drive_mime_type,
          drive_web_view_link
        )
        VALUES (
          ${subjectId},
          ${materialId},
          ${weekNumber},
          ${sessionDate},
          ${weekdayIndex},
          ${nextOrderIndex},
          ${transcriptText},
          ${driveFile.id},
          ${driveFile.name},
          ${driveFile.mimeType},
          ${driveFile.webViewLink || ""}
        )
        RETURNING id, subject_day_material_id, subject_id, week_number, session_date, weekday_index, order_index, transcript_text, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, answer_text, custom_title, practice_state, FALSE AS is_featured, created_at, updated_at
      ` as EntryRow[]
    } catch (error) {
      if (!isMissingColumn(error)) throw error

      rows = await sql`
        INSERT INTO subject_day_entries (
          subject_id,
          week_number,
          session_date,
          weekday_index,
          order_index,
          transcript_text,
          drive_file_id,
          drive_file_name,
          drive_mime_type,
          drive_web_view_link
        )
        VALUES (
          ${subjectId},
          ${weekNumber},
          ${sessionDate},
          ${weekdayIndex},
          ${nextOrderIndex},
          ${transcriptText},
          ${driveFile.id},
          ${driveFile.name},
          ${driveFile.mimeType},
          ${driveFile.webViewLink || ""}
        )
        RETURNING id, NULL::INTEGER AS subject_day_material_id, subject_id, week_number, session_date, weekday_index, order_index, transcript_text, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, answer_text, NULL::TEXT AS custom_title, NULL::TEXT AS practice_state, FALSE AS is_featured, created_at, updated_at
      ` as EntryRow[]
    }

    return NextResponse.json(formatEntry(rows[0] as EntryRow))
  } catch (error) {
    console.error("POST /api/subject-day-entries/complete error:", error)
    if (isMissingSubjectDayEntriesTable(error)) {
      return NextResponse.json(
        { error: "Falta crear la tabla subject_day_entries. Ejecuta scripts/005-create-subject-day-entries.sql y scripts/006-add-subject-day-entry-metadata.sql en Neon." },
        { status: 503 }
      )
    }
    const message = error instanceof Error ? error.message : "Failed to complete entry upload"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
