import { neon } from "@neondatabase/serverless"
import { NextResponse } from "next/server"

import { buildR2ObjectKey, createR2UploadSession } from "@/lib/r2"
import { getWeekNumberForDate, getWeekdayIndexFromDateKey, parseDateKey } from "@/lib/subject-utils"
import { ensureSubjectAccess, requireAuthSession } from "@/lib/authz"

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
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

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

    const forbidden = ensureSubjectAccess(auth.session!, subjectId)
    if (forbidden) return forbidden

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

    const objectKey = buildR2ObjectKey({
      subjectName,
      weekNumber,
      weekdayIndex,
      fileName: finalFileName,
    })
    const session = await createR2UploadSession({
      objectKey,
      mimeType,
      metadata: {
        "subject-id": subjectId,
        "subject-name": subjectName.replace(/\n/g, " ").trim(),
        "session-date": sessionDate,
        "week-number": String(weekNumber),
        "weekday-index": String(weekdayIndex),
        "material-type": materialType,
        "original-file-name": finalFileName,
      },
    })

    return NextResponse.json({
      uploadMode: session.uploadMode,
      objectKey: session.objectKey,
      uploadUrl: session.uploadUrl,
      headers: session.headers,
      metadata: session.metadata,
      mimeType: session.mimeType,
      fileName: session.fileName,
      driveFileId: session.driveFileId,
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
