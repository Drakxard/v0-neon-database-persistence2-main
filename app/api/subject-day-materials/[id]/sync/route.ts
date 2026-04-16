import { neon } from "@neondatabase/serverless"
import { NextResponse } from "next/server"

import { ensureSubjectAccess, requireAuthSession } from "@/lib/authz"
import {
  extractHighlightSnapshotFromPdfBytes,
  isPdfMigrationDocumentReadError,
  parseHighlightSnapshot,
} from "@/lib/pdf-highlight-migration"
import { buildR2ObjectKey, uploadR2Object } from "@/lib/r2"
import { getSubjectById } from "@/lib/subjects"
import { deleteSubjectDayMaterialRemoteFile } from "@/lib/subject-day-materials-maintenance"

export const runtime = "nodejs"

const sql = neon(process.env.DATABASE_URL!)

type SubjectDayMaterialRow = {
  id: number
  subject_id: string
  week_number: number
  session_date: string
  weekday_index: number
  material_type: "theory" | "practice"
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

function normalizeRow(row: SubjectDayMaterialRow | null) {
  if (!row) return null
  return {
    ...row,
    session_date: normalizeSessionDateKey(row.session_date),
  }
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

async function upsertHighlightSnapshot(params: {
  materialId: number
  sourcePdfFingerprint: string
  highlightsJson: string
}) {
  await sql`
    INSERT INTO subject_day_material_highlight_snapshots (
      material_id,
      source_pdf_fingerprint,
      highlights_json
    )
    VALUES (
      ${params.materialId},
      ${params.sourcePdfFingerprint},
      ${params.highlightsJson}::jsonb
    )
    ON CONFLICT (material_id) DO UPDATE
    SET
      source_pdf_fingerprint = EXCLUDED.source_pdf_fingerprint,
      highlights_json = EXCLUDED.highlights_json,
      updated_at = NOW()
  `
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const { id } = await context.params
    const materialId = Number.parseInt(id, 10)
    if (!Number.isInteger(materialId)) {
      return badRequest("Invalid material id")
    }

    const rows = await sql`
      SELECT id, subject_id, week_number, session_date, weekday_index, material_type, order_index, file_name, drive_file_id, drive_mime_type, drive_web_view_link, is_checkup_done, created_at, updated_at
      FROM subject_day_materials
      WHERE id = ${materialId}
      LIMIT 1
    ` as SubjectDayMaterialRow[]

    const material = rows[0]
    if (!material) {
      return NextResponse.json({ error: "Material not found" }, { status: 404 })
    }

    const forbidden = ensureSubjectAccess(auth.session!, material.subject_id)
    if (forbidden) return forbidden

    const formData = await request.formData()
    const fileEntry = formData.get("file")
    if (!(fileEntry instanceof File)) {
      return badRequest("Missing file")
    }

    const mimeType = String(fileEntry.type || "").trim() || "application/pdf"
    if (mimeType !== "application/pdf") {
      return badRequest("Only PDF files are allowed")
    }

    const requestedFileName = normalizeUploadedPdfFileName(String(formData.get("fileName") || "").trim())
    const nextFileName = requestedFileName || normalizeUploadedPdfFileName(material.file_name)
    if (!nextFileName) {
      return badRequest("Missing fileName for synced PDF")
    }

    const subjectName = getSubjectById(material.subject_id)?.name.replace(/\n/g, " ") || material.subject_id
    const objectKey = buildR2ObjectKey({
      subjectName,
      weekNumber: material.week_number,
      weekdayIndex: material.weekday_index,
      fileName: nextFileName,
    })

    const arrayBuffer = await fileEntry.arrayBuffer()
    const pdfBuffer = Buffer.from(arrayBuffer)
    await uploadR2Object({
      objectKey,
      mimeType,
      body: pdfBuffer,
      metadata: {
        "subject-id": material.subject_id,
        "subject-name": subjectName,
        "session-date": normalizeSessionDateKey(material.session_date),
        "week-number": String(material.week_number),
        "weekday-index": String(material.weekday_index),
        "material-type": material.material_type,
        "original-file-name": nextFileName,
      },
    })

    const previousDriveFileId = material.drive_file_id
    const requestedSourceFingerprint = String(formData.get("sourcePdfFingerprint") || "").trim()
    const parsedHighlightSnapshot = parseHighlightSnapshot(formData.get("highlightSnapshot"))
    const extractedSnapshot =
      parsedHighlightSnapshot.length > 0
        ? {
            sourceFingerprint:
              requestedSourceFingerprint ||
              parsedHighlightSnapshot[0]?.sourceFingerprint ||
              "",
            snapshot: parsedHighlightSnapshot,
          }
        : await extractHighlightSnapshotFromPdfBytes(pdfBuffer, requestedSourceFingerprint)

    const updatedRows = await sql`
      UPDATE subject_day_materials
      SET
        file_name = ${nextFileName},
        drive_file_id = ${objectKey},
        drive_mime_type = ${mimeType},
        drive_web_view_link = '',
        updated_at = NOW()
      WHERE id = ${materialId}
      RETURNING id, subject_id, week_number, session_date, weekday_index, material_type, order_index, file_name, drive_file_id, drive_mime_type, drive_web_view_link, is_checkup_done, created_at, updated_at
    ` as SubjectDayMaterialRow[]

    const updatedMaterial = updatedRows[0]
    if (!updatedMaterial) {
      return NextResponse.json({ error: "Material not found" }, { status: 404 })
    }

    await upsertHighlightSnapshot({
      materialId,
      sourcePdfFingerprint: extractedSnapshot.sourceFingerprint,
      highlightsJson: JSON.stringify(extractedSnapshot.snapshot),
    })

    if (previousDriveFileId && previousDriveFileId !== objectKey) {
      try {
        await deleteSubjectDayMaterialRemoteFile({
          materialId,
          driveFileId: previousDriveFileId,
        })
      } catch (error) {
        console.warn("POST /api/subject-day-materials/[id]/sync remote cleanup warning:", error)
      }
    }

    return NextResponse.json(normalizeRow(updatedMaterial))
  } catch (error) {
    console.error("POST /api/subject-day-materials/[id]/sync error:", error)
    if (isMissingSubjectDayMaterialsTable(error)) {
      return NextResponse.json(
        { error: "Falta crear la tabla subject_day_materials. Ejecuta scripts/008-create-subject-day-materials.sql en Neon." },
        { status: 503 }
      )
    }

    const message = isPdfMigrationDocumentReadError(error)
      ? "No se pudo leer el PDF sincronizado para extraer resaltados."
      : error instanceof Error
        ? error.message
        : "Failed to sync material"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
