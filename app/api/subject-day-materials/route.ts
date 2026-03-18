import { neon } from "@neondatabase/serverless"
import { NextResponse } from "next/server"
import { getWeekNumberForDate, parseDateKey } from "@/lib/subject-utils"
import { ensureSubjectAccess, requireAuthSession } from "@/lib/authz"

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
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const { searchParams } = new URL(request.url)
    const subjectId = searchParams.get("subjectId")
    const sessionDate = searchParams.get("sessionDate")
    const scope = searchParams.get("scope")

    if (!subjectId) {
      return badRequest("Missing subjectId")
    }

    const forbidden = ensureSubjectAccess(auth.session!, subjectId)
    if (forbidden) return forbidden

    const rawWeekNumber = Number.parseInt(searchParams.get("weekNumber") || "", 10)
    let weekNumber = rawWeekNumber

    let rows: SubjectDayMaterialRow[]
    if (scope === "week") {
      if (Number.isNaN(rawWeekNumber)) {
        return badRequest("Missing weekNumber")
      }

      rows = await sql`
        SELECT id, subject_id, week_number, session_date, weekday_index, material_type, order_index, file_name, drive_file_id, drive_mime_type, drive_web_view_link, is_checkup_done, created_at, updated_at
        FROM subject_day_materials
        WHERE subject_id = ${subjectId} AND week_number = ${weekNumber} AND material_type = 'practice'
        ORDER BY session_date ASC, order_index ASC, id ASC
      ` as SubjectDayMaterialRow[]
    } else {
      if (!sessionDate) {
        return badRequest("Missing sessionDate")
      }

      const parsedSessionDate = parseSessionDate(sessionDate)
      if (!parsedSessionDate) {
        return badRequest("Invalid sessionDate")
      }

      weekNumber = Number.isNaN(rawWeekNumber) ? getWeekNumberForDate(parsedSessionDate) : rawWeekNumber

      rows = await sql`
        SELECT id, subject_id, week_number, session_date, weekday_index, material_type, order_index, file_name, drive_file_id, drive_mime_type, drive_web_view_link, is_checkup_done, created_at, updated_at
        FROM subject_day_materials
        WHERE subject_id = ${subjectId} AND week_number = ${weekNumber} AND session_date = ${sessionDate}
        ORDER BY material_type ASC, order_index ASC, id ASC
      ` as SubjectDayMaterialRow[]
    }

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
  void request
  return NextResponse.json(
    { error: "Legacy upload is disabled. Use /api/subject-day-materials/upload-session and /complete." },
    { status: 410 }
  )
}
