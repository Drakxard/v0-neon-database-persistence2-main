import { neon } from "@neondatabase/serverless"
import { NextResponse } from "next/server"

import { uploadFileToDrive } from "@/lib/google-drive"
import { getWeekNumberForDate, getWeekdayIndexFromDateKey, parseDateKey } from "@/lib/subject-utils"

export const runtime = "nodejs"

const sql = neon(process.env.DATABASE_URL!)

type MaterialType = "theory" | "practice"

type SubjectDayMaterialRow = {
  id: number
  subject_id: string
  week_number: number
  session_date: string
  weekday_index: number
  material_type: MaterialType
  order_index: number
  file_name: string
  drive_file_id: string
  drive_mime_type: string
  drive_web_view_link: string
  is_checkup_done: boolean
  created_at: string
  updated_at: string
}

function isMissingSubjectDayMaterialsTable(error: unknown) {
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

function normalizeSessionDateKey(sessionDate: string | Date) {
  if (sessionDate instanceof Date) {
    return `${sessionDate.getFullYear()}-${String(sessionDate.getMonth() + 1).padStart(2, "0")}-${String(sessionDate.getDate()).padStart(2, "0")}`
  }

  return sessionDate.includes("T") ? sessionDate.slice(0, 10) : sessionDate
}

function normalizeRows(rows: SubjectDayMaterialRow[]) {
  return rows.map((row) => ({
    ...row,
    session_date: normalizeSessionDateKey(row.session_date),
  }))
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const subjectId = searchParams.get("subjectId")
    const sessionDate = searchParams.get("sessionDate")

    if (!subjectId || !sessionDate) {
      return badRequest("Missing subjectId or sessionDate")
    }

    const parsedSessionDate = parseSessionDate(sessionDate)
    if (!parsedSessionDate) {
      return badRequest("Invalid sessionDate")
    }

    const rawWeekNumber = Number.parseInt(searchParams.get("weekNumber") || "", 10)
    const weekNumber = Number.isNaN(rawWeekNumber) ? getWeekNumberForDate(parsedSessionDate) : rawWeekNumber

    const rows = await sql`
      SELECT id, subject_id, week_number, session_date, weekday_index, material_type, order_index, file_name, drive_file_id, drive_mime_type, drive_web_view_link, is_checkup_done, created_at, updated_at
      FROM subject_day_materials
      WHERE subject_id = ${subjectId} AND week_number = ${weekNumber} AND session_date = ${sessionDate}
      ORDER BY material_type ASC, order_index ASC, id ASC
    ` as SubjectDayMaterialRow[]

    return NextResponse.json(normalizeRows(rows))
  } catch (error) {
    console.error("GET /api/subject-day-materials error:", error)
    if (isMissingSubjectDayMaterialsTable(error)) {
      return NextResponse.json([])
    }
    return NextResponse.json({ error: "Failed to fetch materials" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData()
    const subjectId = String(formData.get("subjectId") || "").trim()
    const subjectName = String(formData.get("subjectName") || "").trim()
    const sessionDate = String(formData.get("sessionDate") || "").trim()
    const materialType = String(formData.get("materialType") || "").trim() as MaterialType
    const requestedWeekNumber = Number.parseInt(String(formData.get("weekNumber") || ""), 10)
    const file = formData.get("file")

    const parsedSessionDate = parseSessionDate(sessionDate)
    if (!subjectId || !subjectName || !parsedSessionDate) {
      return badRequest("Missing subject metadata")
    }

    if (materialType !== "theory" && materialType !== "practice") {
      return badRequest("Invalid materialType")
    }

    if (!(file instanceof File) || file.size === 0) {
      return badRequest("Missing file")
    }

    const mimeType = file.type || "application/pdf"
    if (mimeType !== "application/pdf") {
      return badRequest("Only PDF files are allowed")
    }

    const arrayBuffer = await file.arrayBuffer()
    const fileBuffer = Buffer.from(arrayBuffer)
    const derivedWeekNumber = getWeekNumberForDate(parsedSessionDate)
    const weekNumber =
      Number.isNaN(requestedWeekNumber) || requestedWeekNumber !== derivedWeekNumber ? derivedWeekNumber : requestedWeekNumber
    const weekdayIndex = getWeekdayIndexFromDateKey(sessionDate)

    const [orderRow] = await sql`
      SELECT COALESCE(MAX(order_index), -1) AS max_order
      FROM subject_day_materials
      WHERE subject_id = ${subjectId} AND week_number = ${weekNumber} AND session_date = ${sessionDate} AND material_type = ${materialType}
    `
    const nextOrderIndex = Math.max(1, Number(orderRow?.max_order ?? 0) + 1)

    const safeFileName = file.name.trim() || `${materialType}-${sessionDate}-${nextOrderIndex + 1}.pdf`
    const driveFile = await uploadFileToDrive({
      subjectName,
      weekNumber,
      weekdayIndex,
      mimeType,
      fileBuffer,
      fileName: safeFileName,
    })

    const rows = await sql`
      INSERT INTO subject_day_materials (
        subject_id,
        week_number,
        session_date,
        weekday_index,
        material_type,
        order_index,
        file_name,
        drive_file_id,
        drive_mime_type,
        drive_web_view_link
      )
      VALUES (
        ${subjectId},
        ${weekNumber},
        ${sessionDate},
        ${weekdayIndex},
        ${materialType},
        ${nextOrderIndex},
        ${driveFile.name},
        ${driveFile.id},
        ${driveFile.mimeType},
        ${driveFile.webViewLink || ""}
      )
      RETURNING id, subject_id, week_number, session_date, weekday_index, material_type, order_index, file_name, drive_file_id, drive_mime_type, drive_web_view_link, is_checkup_done, created_at, updated_at
    ` as SubjectDayMaterialRow[]

    return NextResponse.json(normalizeRows(rows)[0])
  } catch (error) {
    console.error("POST /api/subject-day-materials error:", error)
    if (isMissingSubjectDayMaterialsTable(error)) {
      return NextResponse.json(
        { error: "Falta crear la tabla subject_day_materials. Ejecuta scripts/008-create-subject-day-materials.sql en Neon." },
        { status: 503 }
      )
    }
    const message = error instanceof Error ? error.message : "Failed to create material"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
