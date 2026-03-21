import { neon } from "@neondatabase/serverless"

import { getSubjectById, SUBJECTS } from "@/lib/subjects"
import { getWeekDates, getWeekdayIndexFromDateKey, WEEKDAY_NAMES, formatDateKey } from "@/lib/subject-utils"
import { getR2ObjectMetadatas, isR2ObjectKey, listR2ObjectsByPrefix } from "@/lib/r2"

const sql = neon(process.env.DATABASE_URL!)

export type MaterialType = "theory" | "practice"

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

type ReconcileScope = {
  subjectId?: string
  weekNumber?: number
  sessionDate?: string
  materialType?: MaterialType | null
}

type R2CandidateMaterial = {
  driveFileId: string
  fileName: string
  mimeType: string
  subjectId: string
  weekNumber: number
  sessionDate: string
  weekdayIndex: number
  materialType: MaterialType
}

type CandidateBuildFailureReason =
  | "metadata-incomplete"
  | "legacy-shape-invalid"

type ScopeMismatchReason =
  | "subject-id-mismatch"
  | "week-number-mismatch"
  | "session-date-mismatch"
  | "material-type-mismatch"

type ReconcileDiagnostics = {
  listedObjects: number
  pdfObjects: number
  candidates: number
  discardedNonPdf: number
  discardedByBuildReason: Partial<Record<CandidateBuildFailureReason, number>>
  discardedByScopeReason: Partial<Record<ScopeMismatchReason, number>>
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

function sanitizePathSegment(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "archivo"
}

function getLegacySubjectIdFromKeySegment(segment: string) {
  const normalizedSegment = sanitizePathSegment(segment)
  return SUBJECTS.find((subject) => sanitizePathSegment(subject.name.replace(/\n/g, " ")) === normalizedSegment)?.id ?? null
}

function getLegacySessionDateFromWeekAndDay(weekNumber: number, weekdayNameSegment: string) {
  const dayIndex = WEEKDAY_NAMES.findIndex((weekday) => sanitizePathSegment(weekday) === sanitizePathSegment(weekdayNameSegment))
  if (dayIndex < 0) return null

  const weekDates = getWeekDates(weekNumber)
  const sessionDate = weekDates[dayIndex]
  return sessionDate ? formatDateKey(sessionDate) : null
}

function buildScopedR2Prefix(scope: ReconcileScope) {
  if (!scope.subjectId) return "r2/"

  const subject = getSubjectById(scope.subjectId)
  if (!subject) return "r2/"

  const subjectSegment = sanitizePathSegment(subject.name.replace(/\n/g, " "))
  if (!Number.isInteger(scope.weekNumber)) {
    return `r2/${subjectSegment}/`
  }

  let prefix = `r2/${subjectSegment}/semana-${scope.weekNumber}/`
  if (scope.sessionDate) {
    const weekdayIndex = getWeekdayIndexFromDateKey(scope.sessionDate)
    const weekdaySegment = sanitizePathSegment(WEEKDAY_NAMES[weekdayIndex] || `dia-${weekdayIndex + 1}`)
    prefix = `${prefix}${weekdaySegment}/`
  }

  return prefix
}

function parseMaterialType(value: string | undefined) {
  if (value === "theory" || value === "practice") return value
  return null
}

function inferLegacyMaterialType(fileName: string) {
  const normalizedName = sanitizePathSegment(fileName)
  if (
    normalizedName.includes("guia") ||
    normalizedName.includes("resp") ||
    normalizedName.includes("ejer") ||
    normalizedName.includes("pract")
  ) {
    return "practice" as const
  }

  return "theory" as const
}

function buildCandidateFromMetadata(params: {
  objectKey: string
  name: string
  mimeType: string
  metadata: Record<string, string>
}) {
  const subjectId = String(params.metadata["subject-id"] || "").trim()
  const weekNumber = Number.parseInt(String(params.metadata["week-number"] || ""), 10)
  const sessionDate = String(params.metadata["session-date"] || "").trim()
  const weekdayIndex = Number.parseInt(String(params.metadata["weekday-index"] || ""), 10)
  const materialType = parseMaterialType(params.metadata["material-type"])
  const originalFileName = normalizeUploadedPdfFileName(String(params.metadata["original-file-name"] || "").trim() || params.name)

  if (!subjectId || !Number.isInteger(weekNumber) || !sessionDate || !Number.isInteger(weekdayIndex) || !materialType || !originalFileName) {
    return null
  }

  return {
    driveFileId: params.objectKey,
    fileName: originalFileName,
    mimeType: params.mimeType,
    subjectId,
    weekNumber,
    sessionDate: normalizeSessionDateKey(sessionDate),
    weekdayIndex,
    materialType,
  } satisfies R2CandidateMaterial
}

function buildCandidateFromLegacyKey(params: {
  objectKey: string
  name: string
  mimeType: string
  scope: ReconcileScope
}) {
  const segments = params.objectKey.split("/")
  if (segments.length < 5) return null

  const subjectId = getLegacySubjectIdFromKeySegment(segments[1] || "")
  const weekMatch = /^semana-(\d+)$/.exec(segments[2] || "")
  const weekNumber = weekMatch ? Number.parseInt(weekMatch[1], 10) : Number.NaN
  const sessionDate = Number.isInteger(weekNumber) ? getLegacySessionDateFromWeekAndDay(weekNumber, segments[3] || "") : null
  const originalFileName = normalizeUploadedPdfFileName(params.name)
  const inferredMaterialType = params.scope.materialType ?? inferLegacyMaterialType(originalFileName)

  if (!subjectId || !Number.isInteger(weekNumber) || !sessionDate || !inferredMaterialType || !originalFileName) {
    return null
  }

  return {
    driveFileId: params.objectKey,
    fileName: originalFileName,
    mimeType: params.mimeType,
    subjectId,
    weekNumber,
    sessionDate,
    weekdayIndex: getWeekdayIndexFromDateKey(sessionDate),
    materialType: inferredMaterialType,
  } satisfies R2CandidateMaterial
}

function matchesScope(candidate: R2CandidateMaterial, scope: ReconcileScope) {
  if (scope.subjectId && candidate.subjectId !== scope.subjectId) return "subject-id-mismatch" as const
  if (Number.isInteger(scope.weekNumber) && candidate.weekNumber !== scope.weekNumber) return "week-number-mismatch" as const
  if (scope.sessionDate && candidate.sessionDate !== scope.sessionDate) return "session-date-mismatch" as const
  if (scope.materialType && candidate.materialType !== scope.materialType) return "material-type-mismatch" as const
  return null
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

export async function reconcileSubjectDayMaterialsFromR2(scope: ReconcileScope) {
  const prefix = buildScopedR2Prefix(scope)
  const listedObjects = await listR2ObjectsByPrefix(prefix)
  const objectKeys = listedObjects.map((object) => object.key).filter((key) => isR2ObjectKey(key))
  const diagnostics: ReconcileDiagnostics = {
    listedObjects: objectKeys.length,
    pdfObjects: 0,
    candidates: 0,
    discardedNonPdf: 0,
    discardedByBuildReason: {},
    discardedByScopeReason: {},
  }

  if (objectKeys.length === 0) {
    return { inserted: 0, scanned: 0, skipped: 0, diagnostics }
  }

  const objectMetadatas = await getR2ObjectMetadatas(objectKeys)
  const candidates: R2CandidateMaterial[] = []

  for (const objectMetadata of objectMetadatas) {
    if (objectMetadata.mimeType !== "application/pdf") {
      diagnostics.discardedNonPdf += 1
      continue
    }

    diagnostics.pdfObjects += 1

    const fromMetadata = buildCandidateFromMetadata({
      objectKey: objectMetadata.id,
      name: objectMetadata.name,
      mimeType: objectMetadata.mimeType,
      metadata: objectMetadata.metadata ?? {},
    })
    const hasMetadataHints = Object.keys(objectMetadata.metadata ?? {}).length > 0

    const legacyCandidate = buildCandidateFromLegacyKey({
        objectKey: objectMetadata.id,
        name: objectMetadata.name,
        mimeType: objectMetadata.mimeType,
        scope,
      })
    const candidate = fromMetadata ?? legacyCandidate

    if (!candidate) {
      const buildReason: CandidateBuildFailureReason = hasMetadataHints ? "metadata-incomplete" : "legacy-shape-invalid"
      diagnostics.discardedByBuildReason[buildReason] = (diagnostics.discardedByBuildReason[buildReason] ?? 0) + 1
      continue
    }

    const scopeMismatch = matchesScope(candidate, scope)
    if (scopeMismatch) {
      diagnostics.discardedByScopeReason[scopeMismatch] = (diagnostics.discardedByScopeReason[scopeMismatch] ?? 0) + 1
      continue
    }

    candidates.push(candidate)
  }

  diagnostics.candidates = candidates.length

  if (candidates.length === 0) {
    return { inserted: 0, scanned: objectKeys.length, skipped: objectKeys.length, diagnostics }
  }

  const existingRows = await sql`
    SELECT drive_file_id
    FROM subject_day_materials
    WHERE drive_file_id = ANY(${candidates.map((candidate) => candidate.driveFileId)})
  ` as Array<{ drive_file_id: string }>

  const existingDriveFileIds = new Set(existingRows.map((row) => row.drive_file_id))
  let inserted = 0

  for (const candidate of candidates) {
    if (existingDriveFileIds.has(candidate.driveFileId)) continue

    const [orderRow] = await sql`
      SELECT COALESCE(MAX(order_index), -1) AS max_order
      FROM subject_day_materials
      WHERE subject_id = ${candidate.subjectId}
        AND week_number = ${candidate.weekNumber}
        AND session_date = ${candidate.sessionDate}
        AND material_type = ${candidate.materialType}
    `
    const nextOrderIndex = Math.max(1, Number(orderRow?.max_order ?? 0) + 1)

    try {
      await sql`
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
          drive_web_view_link,
          is_checkup_done
        )
        VALUES (
          ${candidate.subjectId},
          ${candidate.weekNumber},
          ${candidate.sessionDate},
          ${candidate.weekdayIndex},
          ${candidate.materialType},
          ${nextOrderIndex},
          ${candidate.fileName},
          ${candidate.driveFileId},
          ${candidate.mimeType},
          ${""},
          ${false}
        )
      `

      existingDriveFileIds.add(candidate.driveFileId)
      inserted += 1
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "23505"
      ) {
        const concurrentRow = await findMaterialByDriveFileId(candidate.driveFileId)
        if (concurrentRow) {
          existingDriveFileIds.add(candidate.driveFileId)
          continue
        }
      }

      throw error
    }
  }

  return {
    inserted,
    scanned: objectKeys.length,
    skipped: Math.max(0, objectKeys.length - candidates.length),
    diagnostics,
  }
}

export async function listSubjectDayMaterials(scope: ReconcileScope) {
  let rows: SubjectDayMaterialRow[]

  if (Number.isInteger(scope.weekNumber) && !scope.sessionDate) {
    if (scope.materialType) {
      rows = await sql`
        SELECT id, subject_id, week_number, session_date, weekday_index, material_type, order_index, file_name, drive_file_id, drive_mime_type, drive_web_view_link, is_checkup_done, created_at, updated_at
        FROM subject_day_materials
        WHERE subject_id = ${scope.subjectId!} AND week_number = ${scope.weekNumber!} AND material_type = ${scope.materialType}
        ORDER BY session_date ASC, order_index ASC, id ASC
      ` as SubjectDayMaterialRow[]
    } else {
      rows = await sql`
        SELECT id, subject_id, week_number, session_date, weekday_index, material_type, order_index, file_name, drive_file_id, drive_mime_type, drive_web_view_link, is_checkup_done, created_at, updated_at
        FROM subject_day_materials
        WHERE subject_id = ${scope.subjectId!} AND week_number = ${scope.weekNumber!}
        ORDER BY session_date ASC, material_type ASC, order_index ASC, id ASC
      ` as SubjectDayMaterialRow[]
    }
  } else {
    if (scope.materialType) {
      rows = await sql`
        SELECT id, subject_id, week_number, session_date, weekday_index, material_type, order_index, file_name, drive_file_id, drive_mime_type, drive_web_view_link, is_checkup_done, created_at, updated_at
        FROM subject_day_materials
        WHERE subject_id = ${scope.subjectId!} AND week_number = ${scope.weekNumber!} AND session_date = ${scope.sessionDate!} AND material_type = ${scope.materialType}
        ORDER BY material_type ASC, order_index ASC, id ASC
      ` as SubjectDayMaterialRow[]
    } else {
      rows = await sql`
        SELECT id, subject_id, week_number, session_date, weekday_index, material_type, order_index, file_name, drive_file_id, drive_mime_type, drive_web_view_link, is_checkup_done, created_at, updated_at
        FROM subject_day_materials
        WHERE subject_id = ${scope.subjectId!} AND week_number = ${scope.weekNumber!} AND session_date = ${scope.sessionDate!}
        ORDER BY material_type ASC, order_index ASC, id ASC
      ` as SubjectDayMaterialRow[]
    }
  }

  return normalizeRows(rows)
}
