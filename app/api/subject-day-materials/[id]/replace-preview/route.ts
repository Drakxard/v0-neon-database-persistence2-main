import crypto from "node:crypto"

import { neon } from "@neondatabase/serverless"
import { NextResponse } from "next/server"

import { ensureSubjectAccess, requireAuthSession } from "@/lib/authz"
import {
  buildHighlightMigrationPreview,
  extractHighlightSnapshotFromPdfBytes,
  isPdfMigrationDocumentReadError,
  parseHighlightSnapshot,
  type HighlightMigrationPreview,
  type HighlightMigrationUnmatched,
  type HighlightSnapshotItem,
} from "@/lib/pdf-highlight-migration"
import { buildR2ObjectKey, deleteR2Object, uploadR2Object } from "@/lib/r2"
import { getSubjectById } from "@/lib/subjects"
import { downloadSubjectDayMaterialFileOrAutocleanup } from "@/lib/subject-day-materials-storage"

export const runtime = "nodejs"

const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null

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
  snapshot_source_pdf_fingerprint: string | null
  snapshot_highlights_json: unknown
}

type ReplacementPreviewSource = "viewer" | "database" | "storage" | "none"

function isMissingSubjectDayMaterialsTable(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "42P01" || error.code === "42703")
  )
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

function normalizeUploadedPdfFileName(fileName: string) {
  const trimmed = fileName.trim()
  if (!trimmed) return ""
  return trimmed.toLowerCase().endsWith(".pdf") ? trimmed : `${trimmed}.pdf`
}

function looksLikePdf(bytes: Uint8Array) {
  if (bytes.byteLength === 0) return false
  const headerWindow = Buffer.from(bytes.subarray(0, Math.min(bytes.byteLength, 1024))).toString("latin1")
  return headerWindow.includes("%PDF-")
}

function parseUploadedSourceHighlightSnapshot(value: FormDataEntryValue | null) {
  if (value == null) return []

  try {
    return parseHighlightSnapshot(value)
  } catch {
    throw new Error("Invalid sourceHighlightSnapshot payload")
  }
}

function resolveSourceFingerprint(explicitFingerprint: string, sourceHighlights: HighlightSnapshotItem[]) {
  if (explicitFingerprint) return explicitFingerprint
  return String(sourceHighlights[0]?.sourceFingerprint || "").trim()
}

function buildEmptyPreview(params: {
  candidateFileName: string
  sourceFingerprint: string
  legacyUnmatched: HighlightMigrationUnmatched[]
}) {
  return {
    candidateFileName: params.candidateFileName,
    sourceFingerprint: params.sourceFingerprint,
    candidateFingerprint: "",
    autoMatches: [],
    reviewMatches: [],
    unmatched: params.legacyUnmatched,
    summary: {
      totalHighlights: params.legacyUnmatched.length,
      autoMatches: 0,
      reviewMatches: 0,
      unmatched: params.legacyUnmatched.length,
    },
  } satisfies HighlightMigrationPreview
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
        console.warn("replace-preview expired candidate cleanup warning:", error)
      }
    })
  )
}

async function getMaterialRow(materialId: number) {
  const rows = await sql`
    SELECT
      materials.id,
      materials.subject_id,
      materials.week_number,
      materials.session_date,
      materials.weekday_index,
      materials.material_type,
      materials.order_index,
      materials.file_name,
      materials.drive_file_id,
      materials.drive_mime_type,
      materials.drive_web_view_link,
      materials.is_checkup_done,
      materials.created_at,
      materials.updated_at,
      snapshots.source_pdf_fingerprint AS snapshot_source_pdf_fingerprint,
      snapshots.highlights_json AS snapshot_highlights_json
    FROM subject_day_materials AS materials
    LEFT JOIN subject_day_material_highlight_snapshots AS snapshots
      ON snapshots.material_id = materials.id
    WHERE materials.id = ${materialId}
    LIMIT 1
  ` as SubjectDayMaterialRow[]

  return rows[0] ?? null
}

function mergePreviewUnmatched(
  preview: HighlightMigrationPreview,
  legacyUnmatched: HighlightMigrationUnmatched[],
  sourceHighlights: HighlightSnapshotItem[]
) {
  const unmatched = [...legacyUnmatched, ...preview.unmatched]
  return {
    ...preview,
    unmatched,
    summary: {
      totalHighlights: sourceHighlights.length + legacyUnmatched.length,
      autoMatches: preview.autoMatches.length,
      reviewMatches: preview.reviewMatches.length,
      unmatched: unmatched.length,
    },
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let temporaryObjectKey = ""

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
    const candidateFileName = requestedFileName || normalizeUploadedPdfFileName(fileEntry.name) || normalizeUploadedPdfFileName(material.file_name)
    if (!candidateFileName) {
      return badRequest("Missing fileName for replacement PDF")
    }

    const candidatePdfBytes = new Uint8Array(await fileEntry.arrayBuffer())
    if (!looksLikePdf(candidatePdfBytes)) {
      return badRequest("El archivo seleccionado no es un PDF valido.")
    }

    const viewerSourceHighlights = parseUploadedSourceHighlightSnapshot(formData.get("sourceHighlightSnapshot"))
    const viewerSourceFingerprint = String(formData.get("sourcePdfFingerprint") || "").trim()
    const persistedSourceHighlights = parseHighlightSnapshot(material.snapshot_highlights_json)
    const persistedSourceFingerprint = String(material.snapshot_source_pdf_fingerprint || "").trim()

    let sourceHighlights = viewerSourceHighlights
    let sourceFingerprint = resolveSourceFingerprint(viewerSourceFingerprint, viewerSourceHighlights)
    let legacyUnmatched: HighlightMigrationUnmatched[] = []
    let migrationWarning = ""
    let migrationSource: ReplacementPreviewSource = sourceHighlights.length > 0 ? "viewer" : "none"

    if (sourceHighlights.length === 0 && persistedSourceHighlights.length > 0) {
      sourceHighlights = persistedSourceHighlights
      sourceFingerprint = resolveSourceFingerprint(persistedSourceFingerprint, persistedSourceHighlights)
      migrationSource = "database"
    }

    if (sourceHighlights.length === 0) {
      const currentFile = await downloadSubjectDayMaterialFileOrAutocleanup({
        id: material.id,
        drive_file_id: material.drive_file_id,
      })
      if (currentFile.status === "missing") {
        return NextResponse.json({ error: "El PDF actual ya no existe en el storage." }, { status: 404 })
      }
      if (currentFile.status === "unavailable") {
        const message =
          currentFile.error instanceof Error ? currentFile.error.message : "No se pudo leer el PDF actual."
        return NextResponse.json({ error: message }, { status: 500 })
      }

      try {
        const legacySnapshot = await extractHighlightSnapshotFromPdfBytes(currentFile.value.buffer)
        sourceHighlights = legacySnapshot.snapshot
        sourceFingerprint = legacySnapshot.sourceFingerprint
        legacyUnmatched = legacySnapshot.unmatched
        migrationSource = sourceHighlights.length > 0 ? "storage" : "none"
      } catch (error) {
        if (!isPdfMigrationDocumentReadError(error)) {
          throw error
        }

        migrationWarning =
          viewerSourceHighlights.length > 0
            ? ""
            : "No se pudieron leer los resaltados del PDF actual. El reemplazo seguira sin migrarlos."
      }
    }

    const preview =
      sourceHighlights.length === 0
        ? buildEmptyPreview({
            candidateFileName,
            sourceFingerprint,
            legacyUnmatched,
          })
        : mergePreviewUnmatched(
            await buildHighlightMigrationPreview({
              sourceHighlights,
              candidatePdfBytes,
              candidateFileName,
              sourceFingerprint,
            }),
            legacyUnmatched,
            sourceHighlights
          )

    if (sourceHighlights.length === 0 && !migrationWarning) {
      migrationWarning = "No se encontraron highlights migrables. El reemplazo seguira sin migrarlos."
    }

    const subjectName = getSubjectById(material.subject_id)?.name.replace(/\n/g, " ") || material.subject_id
    temporaryObjectKey = buildR2ObjectKey({
      subjectName,
      weekNumber: material.week_number,
      weekdayIndex: material.weekday_index,
      fileName: `replacement-${candidateFileName}`,
    })

    await uploadR2Object({
      objectKey: temporaryObjectKey,
      mimeType,
      body: Buffer.from(candidatePdfBytes),
      metadata: {
        "subject-id": material.subject_id,
        "material-id": String(material.id),
        "material-type": material.material_type,
        "replacement-temporary": "true",
        "original-file-name": candidateFileName,
      },
    })

    const replacementToken = crypto.randomUUID()
    await sql`
      INSERT INTO subject_day_material_replacement_sessions (
        token,
        material_id,
        candidate_drive_file_id,
        candidate_file_name,
        source_pdf_fingerprint,
        candidate_pdf_fingerprint,
        preview_json,
        expires_at
      )
      VALUES (
        ${replacementToken},
        ${material.id},
        ${temporaryObjectKey},
        ${candidateFileName},
        ${preview.sourceFingerprint},
        ${preview.candidateFingerprint},
        ${JSON.stringify(preview)}::jsonb,
        NOW() + INTERVAL '24 hours'
      )
    `

    return NextResponse.json({
      replacementToken,
      migrationSource,
      migrationWarning,
      ...preview,
    })
  } catch (error) {
    if (temporaryObjectKey) {
      try {
        await deleteR2Object(temporaryObjectKey)
      } catch (cleanupError) {
        console.warn("replace-preview temporary cleanup warning:", cleanupError)
      }
    }

    console.error("POST /api/subject-day-materials/[id]/replace-preview error:", error)
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
      ? "No se pudo leer el PDF para preparar la migracion."
      : error instanceof Error
        ? error.message
        : "Failed to prepare replacement preview"
    const status =
      isPdfMigrationDocumentReadError(error) ||
      message.includes("texto seleccionable") ||
      message.includes("sourceHighlightSnapshot")
        ? 400
        : 500
    return NextResponse.json({ error: message }, { status })
  }
}
