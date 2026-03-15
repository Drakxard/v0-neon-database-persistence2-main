import { neon } from "@neondatabase/serverless"
import { NextResponse } from "next/server"

import { createDriveResumableUploadSession } from "@/lib/google-drive"
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

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

function parseSessionDate(sessionDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) return null
  const parsed = parseDateKey(sessionDate)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed
}

function getFileExtension(mimeType: string) {
  if (mimeType.includes("ogg")) return "ogg"
  if (mimeType.includes("mpeg")) return "mp3"
  if (mimeType.includes("mp4")) return "mp4"
  return "webm"
}

export async function POST(request: Request) {
  try {
    const payload = await request.json()
    const subjectId = String(payload?.subjectId || "").trim()
    const subjectName = String(payload?.subjectName || "").trim()
    const sessionDate = String(payload?.sessionDate || "").trim()
    const parsedSessionDate = parseSessionDate(sessionDate)
    const requestedWeekNumber = Number.parseInt(String(payload?.weekNumber || ""), 10)
    const rawMaterialId = Number.parseInt(String(payload?.materialId || ""), 10)
    const materialId = Number.isNaN(rawMaterialId) ? null : rawMaterialId
    const mimeType = String(payload?.mimeType || "").trim() || "audio/webm"

    if (!subjectId || !subjectName || !sessionDate || !parsedSessionDate) {
      return badRequest("Missing subject metadata")
    }

    if (!mimeType.startsWith("audio/")) {
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
    const safeSubjectName = subjectName.replace(/\s+/g, "-").toLowerCase()
    const fileName = `${safeSubjectName}-${sessionDate}-${nextOrderIndex + 1}.${getFileExtension(mimeType)}`

    const session = await createDriveResumableUploadSession({
      subjectName,
      weekNumber,
      weekdayIndex,
      fileName,
      mimeType,
    })

    return NextResponse.json({
      uploadUrl: session.uploadUrl,
      method: "PUT",
      headers: {
        "Content-Type": mimeType,
      },
      fileName: session.fileName,
    })
  } catch (error) {
    console.error("POST /api/subject-day-entries/upload-session error:", error)
    if (isMissingSubjectDayEntriesTable(error)) {
      return NextResponse.json(
        { error: "Falta crear la tabla subject_day_entries. Ejecuta scripts/005-create-subject-day-entries.sql y scripts/006-add-subject-day-entry-metadata.sql en Neon." },
        { status: 503 }
      )
    }
    const message = error instanceof Error ? error.message : "Failed to create upload session"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
