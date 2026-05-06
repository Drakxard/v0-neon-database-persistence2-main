import { neon } from "@neondatabase/serverless"
import { NextResponse } from "next/server"

import { getDriveFileMetadata } from "@/lib/google-drive"
import { ensureLocalMaterialFromUpload } from "@/lib/local-r2-manifests"
import { getR2ObjectMetadata, isR2ObjectKey } from "@/lib/r2"
import { isLocalStorageMode } from "@/lib/storage-mode"
import { getWeekNumberForDate, getWeekdayIndexFromDateKey, parseDateKey } from "@/lib/subject-utils"
import { ensureSubjectAccess, requireAuthSession } from "@/lib/authz"

export const runtime = "nodejs"

const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null

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

function normalizeUploadedPdfFileName(fileName: string) {
  const trimmed = fileName.trim()
  if (!trimmed) return ""
  return trimmed.toLowerCase().endsWith(".pdf") ? trimmed : `${trimmed}.pdf`
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

async function findMaterialByDriveFileId(driveFileId: string) {
  const rows = await sql`
    SELECT id, subject_id, week_number, session_date, weekday_index, material_type, order_index, file_name, drive_file_id, drive_mime_type, drive_web_view_link, is_checkup_done, created_at, updated_at
    FROM subject_day_materials
    WHERE drive_file_id = ${driveFileId}
    ORDER BY id ASC
    LIMIT 1
  ` as SubjectDayMaterialRow[]

  return rows[0] ?? null
}

function readR2MetadataValue(metadata: Record<string, string> | undefined, key: string) {
  return String(metadata?.[key] || "").trim()
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const payload = await request.json()
    const subjectId = String(payload?.subjectId || "").trim()
    const sessionDate = String(payload?.sessionDate || "").trim()
    const materialType = String(payload?.materialType || "").trim() as MaterialType
    const requestedWeekNumber = Number.parseInt(String(payload?.weekNumber || ""), 10)
    const driveFileId = String(payload?.driveFileId || "").trim()
    const uploadedFileName = String(payload?.fileName || "").trim()

    const parsedSessionDate = parseSessionDate(sessionDate)
    if (!subjectId || !parsedSessionDate || !driveFileId) {
      return badRequest("Missing completion metadata")
    }

    const forbidden = ensureSubjectAccess(auth.session!, subjectId)
    if (forbidden) return forbidden

    if (materialType !== "theory" && materialType !== "practice") {
      return badRequest("Invalid materialType")
    }

    const driveFile = isR2ObjectKey(driveFileId)
      ? await getR2ObjectMetadata(driveFileId)
      : await getDriveFileMetadata(driveFileId)
    if (driveFile.mimeType !== "application/pdf") {
      return badRequest("Only PDF files are allowed")
    }

    if (isR2ObjectKey(driveFileId) && "metadata" in driveFile) {
      const metadataSubjectId = readR2MetadataValue(driveFile.metadata, "subject-id")
      const metadataSessionDate = readR2MetadataValue(driveFile.metadata, "session-date")
      const metadataWeekNumber = Number.parseInt(readR2MetadataValue(driveFile.metadata, "week-number"), 10)
      const metadataMaterialType = readR2MetadataValue(driveFile.metadata, "material-type")

      if (
        (metadataSubjectId && metadataSubjectId !== subjectId) ||
        (metadataSessionDate && metadataSessionDate !== sessionDate) ||
        (Number.isInteger(metadataWeekNumber) && metadataWeekNumber !== requestedWeekNumber && metadataWeekNumber !== getWeekNumberForDate(parsedSessionDate)) ||
        (metadataMaterialType && metadataMaterialType !== materialType)
      ) {
        return badRequest("La metadata del archivo en R2 no coincide con la materia o fecha solicitada")
      }
    }

    const persistedFileName = isR2ObjectKey(driveFileId)
      ? normalizeUploadedPdfFileName(readR2MetadataValue("metadata" in driveFile ? driveFile.metadata : undefined, "original-file-name") || uploadedFileName || driveFile.name)
      : normalizeUploadedPdfFileName(uploadedFileName) || driveFile.name

    if (!persistedFileName) {
      return badRequest("Missing fileName for uploaded PDF")
    }

    const derivedWeekNumber = getWeekNumberForDate(parsedSessionDate)
    const weekNumber =
      Number.isNaN(requestedWeekNumber) || requestedWeekNumber !== derivedWeekNumber ? derivedWeekNumber : requestedWeekNumber
    const weekdayIndex = getWeekdayIndexFromDateKey(sessionDate)

    if (isLocalStorageMode()) {
      const material = await ensureLocalMaterialFromUpload({
        subjectId,
        sessionDate,
        weekNumber,
        weekdayIndex,
        materialType,
        driveFileId: driveFile.id,
        fileName: persistedFileName,
      })

      return NextResponse.json(material)
    }

    const existingRow = await findMaterialByDriveFileId(driveFile.id)
    if (existingRow) {
      return NextResponse.json(normalizeRows([existingRow])[0])
    }

    const [orderRow] = await sql`
      SELECT COALESCE(MAX(order_index), -1) AS max_order
      FROM subject_day_materials
      WHERE subject_id = ${subjectId} AND week_number = ${weekNumber} AND session_date = ${sessionDate} AND material_type = ${materialType}
    `
    const nextOrderIndex = Math.max(1, Number(orderRow?.max_order ?? 0) + 1)

    try {
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
          ${persistedFileName},
          ${driveFile.id},
          ${driveFile.mimeType},
          ${("webViewLink" in driveFile && driveFile.webViewLink) || ""}
        )
        RETURNING id, subject_id, week_number, session_date, weekday_index, material_type, order_index, file_name, drive_file_id, drive_mime_type, drive_web_view_link, is_checkup_done, created_at, updated_at
      ` as SubjectDayMaterialRow[]

      return NextResponse.json(normalizeRows(rows)[0])
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "23505"
      ) {
        const concurrentRow = await findMaterialByDriveFileId(driveFile.id)
        if (concurrentRow) {
          return NextResponse.json(normalizeRows([concurrentRow])[0])
        }
      }

      throw error
    }
  } catch (error) {
    console.error("POST /api/subject-day-materials/complete error:", error)
    if (isMissingSubjectDayMaterialsTable(error)) {
      return NextResponse.json(
        { error: "Falta crear la tabla subject_day_materials. Ejecuta scripts/008-create-subject-day-materials.sql en Neon." },
        { status: 503 }
      )
    }
    const message = error instanceof Error ? error.message : "Failed to complete material upload"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
