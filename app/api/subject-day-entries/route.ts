import { neon } from "@neondatabase/serverless"
import { NextResponse } from "next/server"

import { transcribeAudioWithGemini } from "@/lib/gemini"
import { uploadAudioToDrive } from "@/lib/google-drive"
import { getWeekNumberForDate, getWeekdayIndexFromDateKey, parseDateKey } from "@/lib/subject-utils"

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

type EntryLinkRow = {
  id: number
  entry_id: number
  label: string
  url: string
  order_index: number
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

async function getEntryLinks(entryIds: number[]) {
  if (entryIds.length === 0) return new Map<number, EntryLinkRow[]>()

  let rows: EntryLinkRow[]
  try {
    rows = await sql`
      SELECT id, entry_id, label, url, order_index
      FROM subject_day_entry_links
      WHERE entry_id = ANY(${entryIds})
      ORDER BY entry_id ASC, order_index ASC, id ASC
    ` as EntryLinkRow[]
  } catch (error) {
    if (isMissingSubjectDayEntriesTable(error)) {
      return new Map<number, EntryLinkRow[]>()
    }
    throw error
  }

  const linksByEntry = new Map<number, EntryLinkRow[]>()
  for (const row of rows as EntryLinkRow[]) {
    const current = linksByEntry.get(row.entry_id) ?? []
    current.push(row)
    linksByEntry.set(row.entry_id, current)
  }

  return linksByEntry
}

async function withLinks(rows: EntryRow[]) {
  const linksByEntry = await getEntryLinks(rows.map((row) => row.id))
  return rows.map((row) => ({
    ...row,
    display_title: getDisplayTitle(row),
    external_links: (linksByEntry.get(row.id) ?? []).map((link) => ({
      id: link.id,
      label: link.label,
      url: link.url,
    })),
  }))
}

async function selectEntries(subjectId: string, weekNumber: number, sessionDate?: string) {
  try {
    if (sessionDate) {
      return await sql`
        SELECT id, subject_id, week_number, session_date, weekday_index, order_index, transcript_text, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, answer_text, custom_title, practice_state, created_at, updated_at
        FROM subject_day_entries
        WHERE subject_id = ${subjectId} AND week_number = ${weekNumber} AND session_date = ${sessionDate}
        ORDER BY session_date ASC, order_index ASC, id ASC
      ` as EntryRow[]
    }

    return await sql`
      SELECT id, subject_id, week_number, session_date, weekday_index, order_index, transcript_text, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, answer_text, custom_title, practice_state, created_at, updated_at
      FROM subject_day_entries
      WHERE subject_id = ${subjectId} AND week_number = ${weekNumber}
      ORDER BY session_date ASC, order_index ASC, id ASC
    ` as EntryRow[]
  } catch (error) {
    if (!isMissingColumn(error)) throw error

    if (sessionDate) {
      return await sql`
        SELECT id, subject_id, week_number, session_date, weekday_index, order_index, transcript_text, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, answer_text, NULL::TEXT AS custom_title, NULL::TEXT AS practice_state, created_at, updated_at
        FROM subject_day_entries
        WHERE subject_id = ${subjectId} AND week_number = ${weekNumber} AND session_date = ${sessionDate}
        ORDER BY session_date ASC, order_index ASC, id ASC
      ` as EntryRow[]
    }

    return await sql`
      SELECT id, subject_id, week_number, session_date, weekday_index, order_index, transcript_text, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, answer_text, NULL::TEXT AS custom_title, NULL::TEXT AS practice_state, created_at, updated_at
      FROM subject_day_entries
      WHERE subject_id = ${subjectId} AND week_number = ${weekNumber}
      ORDER BY session_date ASC, order_index ASC, id ASC
    ` as EntryRow[]
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const subjectId = searchParams.get("subjectId")
    const sessionDate = searchParams.get("sessionDate")
    const parsedDate = sessionDate ? parseSessionDate(sessionDate) : null
    const rawWeekNumber = Number.parseInt(searchParams.get("weekNumber") || "", 10)
    const weekNumber = Number.isNaN(rawWeekNumber)
      ? parsedDate
        ? getWeekNumberForDate(parsedDate)
        : Number.NaN
      : rawWeekNumber

    if (!subjectId || Number.isNaN(weekNumber)) {
      return badRequest("Missing subjectId or weekNumber")
    }

    let rows: EntryRow[]
    if (sessionDate && parsedDate) {
      rows = await selectEntries(subjectId, weekNumber, sessionDate)
    } else if (sessionDate) {
      return badRequest("Invalid sessionDate")
    } else {
      rows = await selectEntries(subjectId, weekNumber)
    }

    return NextResponse.json(await withLinks(rows))
  } catch (error) {
    console.error("GET /api/subject-day-entries error:", error)
    if (isMissingSubjectDayEntriesTable(error)) {
      return NextResponse.json([])
    }
    return NextResponse.json({ error: "Failed to fetch entries" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const subjectId = String(formData.get("subjectId") || "").trim()
    const subjectName = String(formData.get("subjectName") || "").trim()
    const sessionDate = String(formData.get("sessionDate") || "").trim()
    const parsedSessionDate = parseSessionDate(sessionDate)
    const requestedWeekNumber = Number.parseInt(String(formData.get("weekNumber") || ""), 10)
    const audioFile = formData.get("audio")

    if (!subjectId || !subjectName || !sessionDate || !parsedSessionDate) {
      return badRequest("Missing subject metadata")
    }

    if (!(audioFile instanceof File) || audioFile.size === 0) {
      return badRequest("Missing audio file")
    }

    const mimeType = audioFile.type || "audio/webm"
    if (!mimeType.startsWith("audio/")) {
      return badRequest("Invalid audio mime type")
    }

    const arrayBuffer = await audioFile.arrayBuffer()
    const audioBuffer = Buffer.from(arrayBuffer)
    const derivedWeekNumber = getWeekNumberForDate(parsedSessionDate)
    const weekNumber =
      Number.isNaN(requestedWeekNumber) || requestedWeekNumber !== derivedWeekNumber ? derivedWeekNumber : requestedWeekNumber
    const weekdayIndex = getWeekdayIndexFromDateKey(sessionDate)

    const [countRow] = await sql`
      SELECT COALESCE(MAX(order_index), -1) AS max_order
      FROM subject_day_entries
      WHERE subject_id = ${subjectId} AND week_number = ${weekNumber} AND session_date = ${sessionDate}
    `
    const nextOrderIndex = Number(countRow?.max_order ?? -1) + 1

    const safeSubjectName = subjectName.replace(/\s+/g, "-").toLowerCase()
    const driveFile = await uploadAudioToDrive({
      subjectName,
      weekNumber,
      weekdayIndex,
      mimeType,
      fileBuffer: audioBuffer,
      fileName: `${safeSubjectName}-${sessionDate}-${nextOrderIndex + 1}.${mimeType.includes("ogg") ? "ogg" : mimeType.includes("mpeg") ? "mp3" : "webm"}`,
    })

    let transcriptText = "Transcripcion pendiente."
    try {
      transcriptText = await transcribeAudioWithGemini({
        audioBuffer,
        mimeType,
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
        RETURNING id, subject_id, week_number, session_date, weekday_index, order_index, transcript_text, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, answer_text, custom_title, practice_state, created_at, updated_at
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
        RETURNING id, subject_id, week_number, session_date, weekday_index, order_index, transcript_text, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, answer_text, NULL::TEXT AS custom_title, NULL::TEXT AS practice_state, created_at, updated_at
      ` as EntryRow[]
    }

    return NextResponse.json((await withLinks([rows[0] as EntryRow]))[0])
  } catch (error) {
    console.error("POST /api/subject-day-entries error:", error)
    if (isMissingSubjectDayEntriesTable(error)) {
      return NextResponse.json(
        { error: "Falta crear la tabla subject_day_entries. Ejecuta scripts/005-create-subject-day-entries.sql y scripts/006-add-subject-day-entry-metadata.sql en Neon." },
        { status: 503 }
      )
    }
    const message = error instanceof Error ? error.message : "Failed to create entry"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
