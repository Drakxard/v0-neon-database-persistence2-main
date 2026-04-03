import { neon } from "@neondatabase/serverless"

import { getSubjectById } from "@/lib/subjects"

const sql = neon(process.env.DATABASE_URL!)
const MOBILE_REVIEW_TIME_ZONE = "America/Buenos_Aires"

export type PracticeMaterialCoverageStatus = "sin_tocar" | "tocado_sin_dupla" | "cubierto_minimo"
export type SubjectVectorSeverity = "green" | "yellow" | "red"
export type SubjectVectorState = "sin_dupla_en_pdf_relevante" | "sin_interaccion_movil_reciente" | "fragil" | "cerrable" | "parcial"
export type SubjectVectorReason =
  | "sin_dupla_en_pdf_relevante"
  | "sin_interaccion_movil_reciente"
  | "fragil"

export type PracticeMaterialCoverage = {
  id: number
  fileName: string
  sessionDate: string
  createdDate: string
  isCheckupDone: boolean
  entryCount: number
  pairCount: number
  status: PracticeMaterialCoverageStatus
}

export type SubjectSixDayVector = {
  subjectId: string
  subjectName: string
  weekNumber: number
  startDate: string | null
  currentDay: number | null
  endDate: string | null
  isActive: boolean
  relevantPracticeMaterialIds: number[]
  coveredPracticeMaterialIds: number[]
  totalPracticeMaterialIds: number[]
  staleReason: SubjectVectorReason[]
  severity: SubjectVectorSeverity
  stateLabel: SubjectVectorState
  lastInteractionAt: string | null
  practiceMaterials: PracticeMaterialCoverage[]
}

type SubjectDayMaterialCoverageRow = {
  id: number
  subject_id: string
  week_number: number
  material_type: "theory" | "practice"
  session_date: string | Date
  file_name: string
  is_checkup_done: boolean
  created_at: string | Date
}

type SubjectDayEntryCoverageRow = {
  id: number
  subject_id: string
  week_number: number
  session_date: string | Date
  subject_day_material_id: number | null
  pair_id: string | null
  updated_at: string | Date
}

type MobileInteractionCoverageRow = {
  subject_id: string
  week_number: number
  created_at: string | Date
  rating: "ok" | "doubt" | "fail" | null
}

function getTimeZonePart(date: Date, part: Intl.DateTimeFormatPartTypes) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: MOBILE_REVIEW_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })

  return formatter.formatToParts(date).find((item) => item.type === part)?.value || ""
}

export function getBuenosAiresDateKey(date = new Date()) {
  const year = getTimeZonePart(date, "year")
  const month = getTimeZonePart(date, "month")
  const day = getTimeZonePart(date, "day")
  return `${year}-${month}-${day}`
}

function toDate(value: string | Date) {
  return value instanceof Date ? value : new Date(value)
}

function toIsoTimestamp(value: string | Date) {
  return toDate(value).toISOString()
}

function timestampToBuenosAiresDateKey(value: string | Date) {
  return getBuenosAiresDateKey(toDate(value))
}

function addDaysToDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`
}

function diffDateKeys(startDateKey: string, endDateKey: string) {
  const [startYear, startMonth, startDay] = startDateKey.split("-").map(Number)
  const [endYear, endMonth, endDay] = endDateKey.split("-").map(Number)
  const start = Date.UTC(startYear, startMonth - 1, startDay)
  const end = Date.UTC(endYear, endMonth - 1, endDay)
  return Math.floor((end - start) / (1000 * 60 * 60 * 24))
}

function normalizeSessionDateKey(value: string | Date) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10)
  }

  if (typeof value === "string") {
    return value.includes("T") ? value.slice(0, 10) : value
  }

  return String(value).slice(0, 10)
}

function buildPracticeMaterialCoverage(
  material: SubjectDayMaterialCoverageRow,
  entryRows: SubjectDayEntryCoverageRow[]
) {
  const pairCount = new Set(entryRows.map((entry) => entry.pair_id).filter((pairId): pairId is string => Boolean(pairId))).size
  const entryCount = entryRows.length
  const status: PracticeMaterialCoverageStatus =
    pairCount > 0 ? "cubierto_minimo" : entryCount > 0 ? "tocado_sin_dupla" : "sin_tocar"

  return {
    id: material.id,
    fileName: material.file_name,
    sessionDate: normalizeSessionDateKey(material.session_date),
    createdDate: timestampToBuenosAiresDateKey(material.created_at),
    isCheckupDone: material.is_checkup_done,
    entryCount,
    pairCount,
    status,
  } satisfies PracticeMaterialCoverage
}

function buildSubjectVector(params: {
  subjectId: string
  weekNumber: number
  materials: SubjectDayMaterialCoverageRow[]
  entries: SubjectDayEntryCoverageRow[]
  interactions: MobileInteractionCoverageRow[]
  now: Date
}) {
  const { subjectId, weekNumber, materials, entries, interactions, now } = params
  const subject = getSubjectById(subjectId)
  const todayKey = getBuenosAiresDateKey(now)
  const theoryMaterials = materials
    .filter((material) => material.material_type === "theory")
    .sort((left, right) => {
      const leftDate = normalizeSessionDateKey(left.session_date)
      const rightDate = normalizeSessionDateKey(right.session_date)
      if (leftDate !== rightDate) return leftDate.localeCompare(rightDate)
      return toIsoTimestamp(left.created_at).localeCompare(toIsoTimestamp(right.created_at))
    })

  const latestTheory = [...theoryMaterials]
    .reverse()
    .find((material) => normalizeSessionDateKey(material.session_date) <= todayKey) ?? null

  if (!latestTheory) {
    return null
  }

  const startDate = normalizeSessionDateKey(latestTheory.session_date)
  const endDate = addDaysToDateKey(startDate, 6)
  const currentDay = diffDateKeys(startDate, todayKey)
  const isActive = currentDay >= 0 && currentDay <= 6

  if (!isActive) {
    return null
  }

  const practiceMaterialRows = materials.filter((material) => material.material_type === "practice")
  const practiceMaterials = practiceMaterialRows
    .map((material) =>
      buildPracticeMaterialCoverage(
        material,
        entries.filter((entry) => entry.subject_day_material_id === material.id)
      )
    )
    .sort((left, right) => {
      if (left.createdDate !== right.createdDate) return left.createdDate.localeCompare(right.createdDate)
      return left.fileName.localeCompare(right.fileName)
    })

  const relevantPracticeMaterials = practiceMaterials.filter((material) => {
    return material.sessionDate >= startDate && material.sessionDate <= endDate
  })

  const totalPracticeMaterials = practiceMaterialRows.filter((material) => material.week_number === weekNumber)

  const lastInteraction =
    [...interactions]
      .filter((interaction) => {
        const interactionDate = timestampToBuenosAiresDateKey(interaction.created_at)
        return interactionDate >= startDate && interactionDate <= endDate
      })
      .sort((left, right) => toIsoTimestamp(right.created_at).localeCompare(toIsoTimestamp(left.created_at)))[0] ?? null

  const recentInteraction = lastInteraction
    ? diffDateKeys(timestampToBuenosAiresDateKey(lastInteraction.created_at), todayKey) <= 1
    : false

  const latestRatedInteraction =
    [...interactions]
      .filter((interaction) => interaction.rating === "ok" || interaction.rating === "doubt" || interaction.rating === "fail")
      .filter((interaction) => {
        const interactionDate = timestampToBuenosAiresDateKey(interaction.created_at)
        return interactionDate >= startDate && interactionDate <= endDate
      })
      .sort((left, right) => toIsoTimestamp(right.created_at).localeCompare(toIsoTimestamp(left.created_at)))[0] ?? null

  const isFragile = latestRatedInteraction?.rating === "doubt" || latestRatedInteraction?.rating === "fail"

  const staleReason: SubjectVectorReason[] = []
  if (relevantPracticeMaterials.some((material) => material.status !== "cubierto_minimo")) {
    staleReason.push("sin_dupla_en_pdf_relevante")
  }
  if (isActive && !recentInteraction) {
    staleReason.push("sin_interaccion_movil_reciente")
  }
  if (isFragile) {
    staleReason.push("fragil")
  }

  const severity: SubjectVectorSeverity =
    staleReason.includes("sin_dupla_en_pdf_relevante") ||
    staleReason.includes("sin_interaccion_movil_reciente")
      ? "red"
      : staleReason.includes("fragil")
        ? "yellow"
        : relevantPracticeMaterials.length > 0
          ? "green"
          : "yellow"

  let stateLabel: SubjectVectorState = "parcial"
  if (staleReason.includes("sin_dupla_en_pdf_relevante")) {
    stateLabel = "sin_dupla_en_pdf_relevante"
  } else if (staleReason.includes("sin_interaccion_movil_reciente")) {
    stateLabel = "sin_interaccion_movil_reciente"
  } else if (staleReason.includes("fragil")) {
    stateLabel = "fragil"
  } else if (relevantPracticeMaterials.every((material) => material.status === "cubierto_minimo") && recentInteraction) {
    stateLabel = "cerrable"
  }

  return {
    subjectId,
    subjectName: subject?.name.replace(/\n/g, " ") || subjectId,
    weekNumber,
    startDate,
    currentDay,
    endDate,
    isActive,
    relevantPracticeMaterialIds: relevantPracticeMaterials.map((material) => material.id),
    coveredPracticeMaterialIds: relevantPracticeMaterials
      .filter((material) => material.status === "cubierto_minimo")
      .map((material) => material.id),
    totalPracticeMaterialIds: totalPracticeMaterials.map((material) => material.id),
    staleReason,
    severity,
    stateLabel,
    lastInteractionAt: lastInteraction ? toIsoTimestamp(lastInteraction.created_at) : null,
    practiceMaterials: relevantPracticeMaterials,
  } satisfies SubjectSixDayVector
}

async function listMaterialsForCoverage(params: {
  analysisDate: string
  subjectIds?: string[]
}) {
  const { analysisDate, subjectIds } = params
  if (subjectIds && subjectIds.length === 0) {
    return []
  }

  const rows = await sql`
    SELECT id, subject_id, week_number, material_type, session_date, file_name, is_checkup_done, created_at
    FROM subject_day_materials
    WHERE material_type IN ('practice', 'theory')
      AND session_date <= ${analysisDate}
      AND (${subjectIds ? subjectIds : null}::TEXT[] IS NULL OR subject_id = ANY(${subjectIds ? subjectIds : null}::TEXT[]))
    ORDER BY session_date ASC, created_at ASC, id ASC
  ` as SubjectDayMaterialCoverageRow[]

  return rows
}

async function listEntriesForCoverage(params: {
  analysisDate: string
  subjectIds?: string[]
}) {
  const { analysisDate, subjectIds } = params
  if (subjectIds && subjectIds.length === 0) {
    return []
  }

  const rows = await sql`
    SELECT id, subject_id, week_number, session_date, subject_day_material_id, pair_id, updated_at
    FROM subject_day_entries
    WHERE session_date <= ${analysisDate}
      AND (${subjectIds ? subjectIds : null}::TEXT[] IS NULL OR subject_id = ANY(${subjectIds ? subjectIds : null}::TEXT[]))
    ORDER BY updated_at DESC, id DESC
  ` as SubjectDayEntryCoverageRow[]

  return rows
}

async function listMobileInteractionsForCoverage(params: {
  analysisDate: string
  subjectIds?: string[]
}) {
  const { analysisDate, subjectIds } = params
  if (subjectIds && subjectIds.length === 0) {
    return []
  }

  try {
    const rows = await sql`
      SELECT subject_id, week_number, created_at, rating
      FROM mobile_review_events
      WHERE created_at <= ${analysisDate}::DATE + INTERVAL '1 day'
        AND (${subjectIds ? subjectIds : null}::TEXT[] IS NULL OR subject_id = ANY(${subjectIds ? subjectIds : null}::TEXT[]))
      ORDER BY created_at DESC, id DESC
    ` as MobileInteractionCoverageRow[]

    return rows
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "42P01") {
      return []
    }
    throw error
  }
}

export async function listSubjectSixDayVectors(params: {
  weekNumber: number
  subjectIds?: string[]
  includeInactive?: boolean
  now?: Date
}) {
  const { weekNumber, subjectIds, includeInactive = false, now = new Date() } = params
  const analysisDate = getBuenosAiresDateKey(now)
  const [materials, entries, interactions] = await Promise.all([
    listMaterialsForCoverage({ analysisDate, subjectIds }),
    listEntriesForCoverage({ analysisDate, subjectIds }),
    listMobileInteractionsForCoverage({ analysisDate, subjectIds }),
  ])

  const subjectKeys = new Set<string>([
    ...materials.map((material) => material.subject_id),
    ...entries.map((entry) => entry.subject_id),
    ...(subjectIds ?? []),
  ])

  const vectors = Array.from(subjectKeys)
    .map((subjectId) =>
      buildSubjectVector({
        subjectId,
        weekNumber,
        materials: materials.filter((material) => material.subject_id === subjectId),
        entries: entries.filter((entry) => entry.subject_id === subjectId),
        interactions: interactions.filter((interaction) => interaction.subject_id === subjectId),
        now,
      })
    )
    .filter((vector): vector is SubjectSixDayVector => Boolean(vector))
    .filter((vector) => includeInactive || vector.isActive)
    .sort((left, right) => {
      if (left.severity !== right.severity) {
        const severityOrder = { red: 0, yellow: 1, green: 2 }
        return severityOrder[left.severity] - severityOrder[right.severity]
      }
      if ((left.currentDay ?? 99) !== (right.currentDay ?? 99)) {
        return (left.currentDay ?? 99) - (right.currentDay ?? 99)
      }
      return left.subjectName.localeCompare(right.subjectName)
    })

  return vectors
}

export async function getSubjectSixDayVector(params: {
  subjectId: string
  weekNumber: number
  now?: Date
}) {
  const { subjectId, weekNumber, now = new Date() } = params
  const vectors = await listSubjectSixDayVectors({
    weekNumber,
    subjectIds: [subjectId],
    includeInactive: true,
    now,
  })

  return vectors[0] ?? null
}
