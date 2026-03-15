import { neon } from "@neondatabase/serverless"
import { NextResponse } from "next/server"

import { createDriveResumableUploadSession } from "@/lib/google-drive"
import { getWeekNumberForDate, getWeekdayIndexFromDateKey, parseDateKey } from "@/lib/subject-utils"

export const runtime = "nodejs"

const sql = neon(process.env.DATABASE_URL!)

type MaterialType = "theory" | "practice"

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

export async function POST(request: Request) {
  try {
    const payload = await request.json()
    const subjectId = String(payload?.subjectId || "").trim()
    const subjectName = String(payload?.subjectName || "").trim()
    const sessionDate = String(payload?.sessionDate || "").trim()
    const materialType = String(payload?.materialType || "").trim() as MaterialType
    const requestedWeekNumber = Number.parseInt(String(payload?.weekNumber || ""), 10)
    const rawFileName = String(payload?.fileName || "").trim()
    const mimeType = String(payload?.mimeType || "").trim() || "application/pdf"

    const parsedSessionDate = parseSessionDate(sessionDate)
    if (!subjectId || !subjectName || !parsedSessionDate) {
      return badRequest("Missing subject metadata")
    }

    if (materialType !== "theory" && materialType !== "practice") {
      return badRequest("Invalid materialType")
    }

    if (mimeType !== "application/pdf") {
      return badRequest("Only PDF files are allowed")
    }

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
    const safeFileName = rawFileName || `${materialType}-${sessionDate}-${nextOrderIndex + 1}.pdf`
    const finalFileName = safeFileName.toLowerCase().endsWith(".pdf") ? safeFileName : `${safeFileName}.pdf`

    const session = await createDriveResumableUploadSession({
      subjectName,
      weekNumber,
      weekdayIndex,
      fileName: finalFileName,
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
    console.error("POST /api/subject-day-materials/upload-session error:", error)
    if (isMissingSubjectDayMaterialsTable(error)) {
      return NextResponse.json(
        { error: "Falta crear la tabla subject_day_materials. Ejecuta scripts/008-create-subject-day-materials.sql en Neon." },
        { status: 503 }
      )
    }
    const message = error instanceof Error ? error.message : "Failed to create upload session"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
