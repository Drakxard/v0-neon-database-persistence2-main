import { neon } from "@neondatabase/serverless"
import { NextResponse } from "next/server"

import { transcribeAudioWithGemini } from "@/lib/gemini"
import { uploadAudioToDrive } from "@/lib/google-drive"
import { getWeekNumberForDate, getWeekdayIndexFromDateKey, parseDateKey } from "@/lib/subject-utils"

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

    if (!subjectId || !sessionDate || !parsedDate || Number.isNaN(weekNumber)) {
      return badRequest("Missing subjectId, weekNumber or sessionDate")
    }

    const rows = await sql`
      SELECT id, subject_id, week_number, session_date, weekday_index, order_index, transcript_text, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, answer_text, created_at, updated_at
      FROM subject_day_entries
      WHERE subject_id = ${subjectId} AND week_number = ${weekNumber} AND session_date = ${sessionDate}
      ORDER BY order_index ASC, id ASC
    `

    return NextResponse.json(rows)
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

    const rows = await sql`
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
      RETURNING id, subject_id, week_number, session_date, weekday_index, order_index, transcript_text, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, answer_text, created_at, updated_at
    `

    return NextResponse.json(rows[0])
  } catch (error) {
    console.error("POST /api/subject-day-entries error:", error)
    if (isMissingSubjectDayEntriesTable(error)) {
      return NextResponse.json(
        { error: "Falta crear la tabla subject_day_entries. Ejecuta scripts/005-create-subject-day-entries.sql en Neon." },
        { status: 503 }
      )
    }
    const message = error instanceof Error ? error.message : "Failed to create entry"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
