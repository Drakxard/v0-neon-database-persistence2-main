import { neon } from "@neondatabase/serverless"
import { NextResponse } from "next/server"

import { ensureSubjectAccess, requireAuthSession } from "@/lib/authz"
import {
  applyHighlightMigrationToPdf,
  isPdfMigrationDocumentReadError,
  type HighlightMigrationDecision,
  type HighlightMigrationMatch,
  type HighlightMigrationPreview,
} from "@/lib/pdf-highlight-migration"
import { buildR2ObjectKey, deleteR2Object, downloadR2Object, uploadR2Object } from "@/lib/r2"
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

type ReplacementSessionRow = {
  token: string
  material_id: number
  candidate_drive_file_id: string
  candidate_file_name: string
  source_pdf_fingerprint: string
  candidate_pdf_fingerprint: string
  preview_json: unknown
}

function isMissingSubjectDayMaterialsTable(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "42P01" || error.code === "42703")
  )
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

async function cleanupExpiredReplacementSessions(materialId: number) {
  const rows = await sql`
    DELETE FROM subject_day_material_replacement_sessions
    WHERE material_id = ${materialId} AND expires_at < NOW()
    RETURNING candidate_drive_file_id
  ` as Array<{ candidate_drive_file_id: string }>

  await Promise.all(
    rows.map(async (row) => {
      try {
        await deleteR2Object(row.candidate_drive_file_id)
      } catch (error) {
        console.warn("replace-commit expired candidate cleanup warning:", error)
      }
    })
  )
}

async function getMaterialRow(materialId: number) {
  const rows = await sql`
    SELECT id, subject_id, week_number, session_date, weekday_index, material_type, order_index, file_name, drive_file_id, drive_mime_type, drive_web_view_link, is_checkup_done, created_at, updated_at
    FROM subject_day_materials
    WHERE id = ${materialId}
    LIMIT 1
  ` as SubjectDayMaterialRow[]

  return rows[0] ?? null
}

function parsePreview(value: unknown) {
  if (typeof value === "string") {
    return JSON.parse(value) as HighlightMigrationPreview
  }

  return value as HighlightMigrationPreview
}

function parseDecisions(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const record = item as Record<string, unknown>
    const annotationId = String(record.annotationId || "").trim()
    const action = String(record.action || "").trim() as HighlightMigrationDecision["action"]
    if (!annotationId || (action !== "accept" && action !== "discard" && action !== "skip")) {
      return []
    }
    return [{ annotationId, action }]
  })
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
  let finalObjectKey = ""

  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const { id } = await context.params
    const materialId = Number.parseInt(id, 10)
    if (!Number.isInteger(materialId)) {
      return badRequest("Invalid material id")
    }

    await cleanupExpiredReplacementSessions(materialId)

    const material = await getMaterialRow(materialId)
    if (!material) {
      return NextResponse.json({ error: "Material not found" }, { status: 404 })
    }

    const forbidden = ensureSubjectAccess(auth.session!, material.subject_id)
    if (forbidden) return forbidden

    const payload = await request.json()
    const replacementToken = String(payload?.replacementToken || "").trim()
    if (!replacementToken) {
      return badRequest("Missing replacement token")
    }

    const decisions = parseDecisions(payload?.decisions)
    const decisionsMap = new Map(decisions.map((decision) => [decision.annotationId, decision.action]))

    const sessionRows = await sql`
      SELECT token, material_id, candidate_drive_file_id, candidate_file_name, source_pdf_fingerprint, candidate_pdf_fingerprint, preview_json
      FROM subject_day_material_replacement_sessions
      WHERE token = ${replacementToken} AND material_id = ${materialId} AND expires_at >= NOW()
      LIMIT 1
    ` as ReplacementSessionRow[]

    const replacementSession = sessionRows[0]
    if (!replacementSession) {
      return NextResponse.json({ error: "La sesion de reemplazo ya no existe o vencio." }, { status: 404 })
    }

    const preview = parsePreview(replacementSession.preview_json)
    const acceptedReviewMatches = (preview.reviewMatches || []).filter(
      (match) => decisionsMap.get(match.highlight.annotationId) === "accept"
    )
    const acceptedMatches: HighlightMigrationMatch[] = [...(preview.autoMatches || []), ...acceptedReviewMatches]

    const candidateFile = await downloadR2Object(replacementSession.candidate_drive_file_id)
    const migrationResult =
      acceptedMatches.length > 0
        ? await applyHighlightMigrationToPdf({
            candidatePdfBytes: candidateFile.buffer,
            matches: acceptedMatches,
            candidateFingerprint: replacementSession.candidate_pdf_fingerprint,
          })
        : {
            pdfBytes: candidateFile.buffer,
            snapshot: [],
            candidateFingerprint: replacementSession.candidate_pdf_fingerprint,
          }

    const subjectName = getSubjectById(material.subject_id)?.name.replace(/\n/g, " ") || material.subject_id
    finalObjectKey = buildR2ObjectKey({
      subjectName,
      weekNumber: material.week_number,
      weekdayIndex: material.weekday_index,
      fileName: replacementSession.candidate_file_name,
    })

    await uploadR2Object({
      objectKey: finalObjectKey,
      mimeType: "application/pdf",
      body: Buffer.from(migrationResult.pdfBytes),
      metadata: {
        "subject-id": material.subject_id,
        "subject-name": subjectName,
        "session-date": normalizeSessionDateKey(material.session_date),
        "week-number": String(material.week_number),
        "weekday-index": String(material.weekday_index),
        "material-type": material.material_type,
        "original-file-name": replacementSession.candidate_file_name,
      },
    })

    const previousDriveFileId = material.drive_file_id
    const updatedRows = await sql`
      UPDATE subject_day_materials
      SET
        file_name = ${replacementSession.candidate_file_name},
        drive_file_id = ${finalObjectKey},
        drive_mime_type = 'application/pdf',
        drive_web_view_link = '',
        updated_at = NOW()
      WHERE id = ${material.id}
      RETURNING id, subject_id, week_number, session_date, weekday_index, material_type, order_index, file_name, drive_file_id, drive_mime_type, drive_web_view_link, is_checkup_done, created_at, updated_at
    ` as SubjectDayMaterialRow[]

    const updatedMaterial = updatedRows[0]
    if (!updatedMaterial) {
      throw new Error("Material not found after replacement")
    }

    await upsertHighlightSnapshot({
      materialId,
      sourcePdfFingerprint: migrationResult.candidateFingerprint,
      highlightsJson: JSON.stringify(migrationResult.snapshot),
    })

    if (previousDriveFileId && previousDriveFileId !== finalObjectKey) {
      try {
        await deleteSubjectDayMaterialRemoteFile({
          materialId,
          driveFileId: previousDriveFileId,
        })
      } catch (error) {
        console.warn("replace-commit previous file cleanup warning:", error)
      }
    }

    await sql`
      DELETE FROM subject_day_material_replacement_sessions
      WHERE token = ${replacementSession.token}
    `

    try {
      await deleteR2Object(replacementSession.candidate_drive_file_id)
    } catch (error) {
      console.warn("replace-commit temporary candidate cleanup warning:", error)
    }

    return NextResponse.json({
      material: normalizeRow(updatedMaterial),
      migratedHighlights: migrationResult.snapshot.length,
      reviewAccepted: acceptedReviewMatches.length,
      reviewSkipped: (preview.reviewMatches || []).length - acceptedReviewMatches.length,
      unmatched: (preview.unmatched || []).length,
    })
  } catch (error) {
    if (finalObjectKey) {
      try {
        await deleteR2Object(finalObjectKey)
      } catch (cleanupError) {
        console.warn("replace-commit uploaded file cleanup warning:", cleanupError)
      }
    }

    console.error("POST /api/subject-day-materials/[id]/replace-commit error:", error)
    if (isMissingSubjectDayMaterialsTable(error)) {
      return NextResponse.json(
        {
          error:
            "Faltan las tablas de migracion de highlights. Ejecuta scripts/026-create-subject-day-material-highlight-snapshots.sql y scripts/027-create-subject-day-material-replacement-sessions.sql en Neon.",
        },
        { status: 503 }
      )
    }

    const message = isPdfMigrationDocumentReadError(error)
      ? "No se pudo leer el PDF para confirmar el reemplazo."
      : error instanceof Error
        ? error.message
        : "Failed to commit replacement"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
