import { neon } from "@neondatabase/serverless"

import type { PracticeMaterialCoverageStatus, SubjectSixDayVector } from "@/lib/audio-coverage"
import { getSubjectSixDayVector } from "@/lib/audio-coverage"
import { downloadDriveFile } from "@/lib/google-drive"
import { downloadR2Object, isR2ObjectKey } from "@/lib/r2"
import { getSubjectById, isValidSubjectId } from "@/lib/subjects"
import { getWeekNumberForDate, getWeekdayIndexFromDateKey, parseDateKey } from "@/lib/subject-utils"

const sql = neon(process.env.DATABASE_URL!)
const MOBILE_REVIEW_TIME_ZONE = "America/Buenos_Aires"

export type MobileReviewPair = {
  pairId: string
  subjectId: string
  subjectName: string
  weekNumber: number
  sessionDate: string
  questionEntryId: number
  questionAudioUrl: string
  questionLabel: string
  answerEntryId: number
  answerAudioUrl: string
  answerLabel: string
}

export type MobileReviewTaskKind = "material_pair" | "subject_anchor" | "coverage_gap"

export type MobileReviewTask = {
  kind: MobileReviewTaskKind
  subjectId: string
  subjectName: string
  weekNumber: number
  vectorDay: number | null
  instruction: string
  staleReason: SubjectSixDayVector["staleReason"]
  lastInteractionAt: string | null
  coverageSnapshot: {
    anchorEntryId: number | null
    relevantPracticeMaterialIds: number[]
    coveredPracticeMaterialIds: number[]
  }
  material: {
    id: number
    fileName: string
    sessionDate: string
    status: PracticeMaterialCoverageStatus
    isCheckupDone: boolean
  } | null
  pair: MobileReviewPair | null
  fallbackPair: MobileReviewPair | null
}

export type MobileReviewResolveResult = {
  state: MobileReviewStateRow
  activeSlot: SlotRow | null
  task: MobileReviewTask | null
  pair: MobileReviewPair | null
  totalPairs: number
  currentIndex: number
  debugReason?: "no_active_slot" | "no_valid_pairs" | "stored_pair_not_found"
}

type MobileReviewStateRow = {
  device_id: string
  current_pair_id: string | null
  current_subject_id: string | null
  current_week_number: number | null
  updated_at: string
}

type SlotRow = {
  id: number
  subject_id: string
  weekday_index: number
  start_time: string
  end_time: string
  enabled: boolean
  priority: number
}

export type MobileReviewSlot = {
  id: number
  subjectId: string
  subjectName: string
  weekdayIndex: number
  startTime: string
  endTime: string
  enabled: boolean
  priority: number
}

export type MobileReviewSlotInput = {
  subjectId: string
  weekdayIndex: number
  startTime: string
  endTime: string
  enabled: boolean
  priority: number
}

type PairRow = {
  pair_id: string
  subject_id: string
  week_number: number
  session_date: string
  material_id: number | null
  file_name: string | null
  question_is_featured: boolean
  answer_is_featured: boolean
  question_entry_id: number
  question_title: string | null
  answer_entry_id: number
  answer_title: string | null
}

type MobileReviewEventInput = {
  deviceId: string
  subjectId: string
  weekNumber: number
  materialId: number | null
  pairId: string | null
  taskKind: MobileReviewTaskKind
  eventType: "shown" | "revealed" | "rated" | "skipped"
  rating: "ok" | "doubt" | "fail" | null
}

function padTime(value: number) {
  return String(value).padStart(2, "0")
}

function getCurrentTimeKey(now = new Date()) {
  return `${padTime(now.getHours())}:${padTime(now.getMinutes())}`
}

function getTimeZonePart(now: Date, part: Intl.DateTimeFormatPartTypes) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: MOBILE_REVIEW_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })

  return formatter.formatToParts(now).find((item) => item.type === part)?.value || ""
}

function getBuenosAiresDateKey(now = new Date()) {
  const year = getTimeZonePart(now, "year")
  const month = getTimeZonePart(now, "month")
  const day = getTimeZonePart(now, "day")
  return `${year}-${month}-${day}`
}

function getBuenosAiresTimeKey(now = new Date()) {
  const hour = getTimeZonePart(now, "hour")
  const minute = getTimeZonePart(now, "minute")
  return `${hour}:${minute}`
}

function getBuenosAiresWeekNumber(now = new Date()) {
  return getWeekNumberForDate(parseDateKey(getBuenosAiresDateKey(now)))
}

function isMissingTable(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "42P01")
}

function isMissingColumn(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "42703")
}

function normalizeSessionDateKey(sessionDate: string | Date) {
  if (sessionDate instanceof Date) {
    return `${sessionDate.getFullYear()}-${String(sessionDate.getMonth() + 1).padStart(2, "0")}-${String(sessionDate.getDate()).padStart(2, "0")}`
  }

  return sessionDate.includes("T") ? sessionDate.slice(0, 10) : sessionDate
}

function mapSlotRow(row: SlotRow): MobileReviewSlot {
  const subject = getSubjectById(row.subject_id)
  return {
    id: row.id,
    subjectId: row.subject_id,
    subjectName: subject?.name.replace(/\n/g, " ") || row.subject_id,
    weekdayIndex: row.weekday_index,
    startTime: row.start_time,
    endTime: row.end_time,
    enabled: row.enabled,
    priority: row.priority,
  }
}

function normalizeTimeValue(value: string) {
  return String(value || "").trim()
}

function isValidTimeValue(value: string) {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value)
}

function compareTimeValue(a: string, b: string) {
  return a.localeCompare(b)
}

export function validateMobileReviewSlotInput(input: Partial<MobileReviewSlotInput>) {
  const subjectId = String(input.subjectId || "").trim()
  if (!isValidSubjectId(subjectId)) {
    throw new Error("Materia invalida.")
  }

  if (!Number.isInteger(input.weekdayIndex) || (input.weekdayIndex as number) < 0 || (input.weekdayIndex as number) > 6) {
    throw new Error("Dia invalido.")
  }

  const startTime = normalizeTimeValue(input.startTime || "")
  const endTime = normalizeTimeValue(input.endTime || "")
  if (!isValidTimeValue(startTime) || !isValidTimeValue(endTime)) {
    throw new Error("Las horas deben usar formato HH:MM.")
  }

  if (compareTimeValue(startTime, endTime) >= 0) {
    throw new Error("La hora de inicio debe ser menor que la hora de fin.")
  }

  const priority = Number(input.priority)
  if (!Number.isInteger(priority)) {
    throw new Error("La prioridad debe ser un numero entero.")
  }

  return {
    subjectId,
    weekdayIndex: Number(input.weekdayIndex),
    startTime,
    endTime,
    enabled: Boolean(input.enabled),
    priority,
  }
}

function mapPairRow(row: PairRow): MobileReviewPair {
  const subject = getSubjectById(row.subject_id)
  return {
    pairId: row.pair_id,
    subjectId: row.subject_id,
    subjectName: subject?.name.replace(/\n/g, " ") || row.subject_id,
    weekNumber: row.week_number,
    sessionDate: normalizeSessionDateKey(row.session_date),
    questionEntryId: row.question_entry_id,
    questionAudioUrl: "",
    questionLabel: row.question_title?.trim() || "Pregunta",
    answerEntryId: row.answer_entry_id,
    answerAudioUrl: "",
    answerLabel: row.answer_title?.trim() || "Respuesta",
  }
}

export async function getOrCreateMobileReviewState(deviceId: string) {
  const normalizedDeviceId = String(deviceId || "").trim()
  if (!normalizedDeviceId) {
    throw new Error("Missing deviceId")
  }

  const rows = await sql`
    INSERT INTO mobile_review_state (device_id)
    VALUES (${normalizedDeviceId})
    ON CONFLICT (device_id)
    DO UPDATE SET device_id = EXCLUDED.device_id
    RETURNING device_id, current_pair_id, current_subject_id, current_week_number, updated_at
  ` as MobileReviewStateRow[]

  return rows[0]
}

export async function getActiveMobileReviewSlot(now = new Date()) {
  const weekdayIndex = getWeekdayIndexFromDateKey(getBuenosAiresDateKey(now))
  const timeKey = getBuenosAiresTimeKey(now)
  const rows = await sql`
    SELECT id, subject_id, weekday_index, start_time, end_time, enabled, priority
    FROM mobile_review_slots
    WHERE enabled = TRUE
      AND weekday_index = ${weekdayIndex}
      AND start_time <= ${timeKey}
      AND end_time >= ${timeKey}
    ORDER BY priority DESC, start_time ASC, id ASC
    LIMIT 1
  ` as SlotRow[]

  return rows[0] ?? null
}

export async function listMobileReviewSlots() {
  const rows = await sql`
    SELECT id, subject_id, weekday_index, start_time, end_time, enabled, priority
    FROM mobile_review_slots
    ORDER BY weekday_index ASC, start_time ASC, priority DESC, id ASC
  ` as SlotRow[]

  return rows.map(mapSlotRow)
}

export async function createMobileReviewSlot(input: Partial<MobileReviewSlotInput>) {
  const normalized = validateMobileReviewSlotInput(input)

  const rows = await sql`
    INSERT INTO mobile_review_slots (
      subject_id,
      weekday_index,
      start_time,
      end_time,
      enabled,
      priority
    ) VALUES (
      ${normalized.subjectId},
      ${normalized.weekdayIndex},
      ${normalized.startTime},
      ${normalized.endTime},
      ${normalized.enabled},
      ${normalized.priority}
    )
    RETURNING id, subject_id, weekday_index, start_time, end_time, enabled, priority
  ` as SlotRow[]

  return mapSlotRow(rows[0])
}

export async function updateMobileReviewSlot(slotId: number, input: Partial<MobileReviewSlotInput>) {
  const normalized = validateMobileReviewSlotInput(input)

  const rows = await sql`
    UPDATE mobile_review_slots
    SET
      subject_id = ${normalized.subjectId},
      weekday_index = ${normalized.weekdayIndex},
      start_time = ${normalized.startTime},
      end_time = ${normalized.endTime},
      enabled = ${normalized.enabled},
      priority = ${normalized.priority},
      updated_at = NOW()
    WHERE id = ${slotId}
    RETURNING id, subject_id, weekday_index, start_time, end_time, enabled, priority
  ` as SlotRow[]

  return rows[0] ? mapSlotRow(rows[0]) : null
}

export async function deleteMobileReviewSlot(slotId: number) {
  const rows = await sql`
    DELETE FROM mobile_review_slots
    WHERE id = ${slotId}
    RETURNING id
  ` as Array<{ id: number }>

  return rows.length > 0
}

async function selectPairCandidates(params: {
  subjectId: string
  weekNumber: number
}) {
  const { subjectId, weekNumber } = params

  const rows = await sql`
    SELECT
      question.pair_id,
      question.subject_id,
      question.week_number,
      question.session_date,
      question.subject_day_material_id AS material_id,
      materials.file_name,
      question.is_featured AS question_is_featured,
      answer.is_featured AS answer_is_featured,
      question.id AS question_entry_id,
      question.custom_title AS question_title,
      answer.id AS answer_entry_id,
      answer.custom_title AS answer_title
    FROM subject_day_entries AS question
    INNER JOIN subject_day_entries AS answer
      ON answer.pair_id = question.pair_id
    LEFT JOIN subject_day_materials AS materials
      ON materials.id = question.subject_day_material_id
    WHERE question.pair_id IS NOT NULL
      AND question.pair_role = 'question'
      AND answer.pair_role = 'answer'
      AND question.subject_id = ${subjectId}
      AND answer.subject_id = question.subject_id
      AND question.week_number = ${weekNumber}
      AND answer.week_number = question.week_number
      AND question.session_date = answer.session_date
      AND (
        (question.subject_day_material_id IS NULL AND answer.subject_day_material_id IS NULL)
        OR question.subject_day_material_id = answer.subject_day_material_id
      )
    ORDER BY question.session_date DESC, question.pair_id ASC
  ` as PairRow[]

  return rows
}

function buildCoverageSnapshot(vector: SubjectSixDayVector | null) {
  return {
    anchorEntryId: vector?.anchorEntryId ?? null,
    relevantPracticeMaterialIds: vector?.relevantPracticeMaterialIds ?? [],
    coveredPracticeMaterialIds: vector?.coveredPracticeMaterialIds ?? [],
  }
}

function resolvePairSelection(params: {
  state: MobileReviewStateRow
  candidates: PairRow[]
  subjectId: string
  weekNumber: number
  forceNext: boolean
}) {
  const { state, candidates, subjectId, weekNumber, forceNext } = params
  if (candidates.length === 0) {
    return {
      selectedRow: null,
      currentIndex: 0,
      totalPairs: 0,
      debugReason: "no_valid_pairs" as MobileReviewResolveResult["debugReason"],
    }
  }

  const currentStoredIndex =
    !forceNext && state.current_pair_id && state.current_subject_id === subjectId && state.current_week_number === weekNumber
      ? candidates.findIndex((row) => row.pair_id === state.current_pair_id)
      : -1

  let selectedIndex = currentStoredIndex
  let debugReason: MobileReviewResolveResult["debugReason"] | undefined
  if (currentStoredIndex === -1 && state.current_pair_id && !forceNext) {
    debugReason = "stored_pair_not_found"
  }

  if (forceNext) {
    const baseIndex = currentStoredIndex >= 0 ? currentStoredIndex : -1
    selectedIndex = (baseIndex + 1 + candidates.length) % candidates.length
  } else if (selectedIndex < 0) {
    selectedIndex = 0
  }

  return {
    selectedRow: candidates[selectedIndex] ?? null,
    currentIndex: selectedIndex + 1,
    totalPairs: candidates.length,
    debugReason,
  }
}

function buildTask(params: {
  kind: MobileReviewTaskKind
  subjectId: string
  weekNumber: number
  vector: SubjectSixDayVector | null
  instruction: string
  material: MobileReviewTask["material"]
  pair: MobileReviewPair | null
  fallbackPair?: MobileReviewPair | null
}) {
  const { kind, subjectId, weekNumber, vector, instruction, material, pair, fallbackPair = null } = params
  const subject = getSubjectById(subjectId)
  return {
    kind,
    subjectId,
    subjectName: subject?.name.replace(/\n/g, " ") || subjectId,
    weekNumber,
    vectorDay: vector?.currentDay ?? null,
    instruction,
    staleReason: vector?.staleReason ?? [],
    lastInteractionAt: vector?.lastInteractionAt ?? null,
    coverageSnapshot: buildCoverageSnapshot(vector),
    material,
    pair,
    fallbackPair,
  } satisfies MobileReviewTask
}

async function updateMobileReviewStatePair(params: {
  state: MobileReviewStateRow
  pair: MobileReviewPair | null
}) {
  const { state, pair } = params
  if (!pair) return state

  const updatedRows = await sql`
    UPDATE mobile_review_state
    SET
      current_pair_id = ${pair.pairId},
      current_subject_id = ${pair.subjectId},
      current_week_number = ${pair.weekNumber},
      updated_at = NOW()
    WHERE device_id = ${state.device_id}
    RETURNING device_id, current_pair_id, current_subject_id, current_week_number, updated_at
  ` as MobileReviewStateRow[]

  return updatedRows[0] ?? state
}

export async function resolveMobileReviewPair(params: {
  deviceId: string
  forceNext?: boolean
  now?: Date
}): Promise<MobileReviewResolveResult> {
  const { deviceId, forceNext = false, now = new Date() } = params
  const state = await getOrCreateMobileReviewState(deviceId)
  const activeSlot = await getActiveMobileReviewSlot(now)
  if (!activeSlot) {
    return { state, activeSlot: null, task: null, pair: null, totalPairs: 0, currentIndex: 0, debugReason: "no_active_slot" }
  }

  const weekNumber = getBuenosAiresWeekNumber(now)
  const vector = await getSubjectSixDayVector({
    subjectId: activeSlot.subject_id,
    weekNumber,
    now,
  })
  const allPairs = await selectPairCandidates({
    subjectId: activeSlot.subject_id,
    weekNumber,
  })

  const anchorCandidates = [...allPairs].sort((left, right) => {
    const leftFeatured = Number(left.question_is_featured || left.answer_is_featured)
    const rightFeatured = Number(right.question_is_featured || right.answer_is_featured)
    if (leftFeatured !== rightFeatured) return rightFeatured - leftFeatured
    const leftAbstract = Number(left.material_id == null)
    const rightAbstract = Number(right.material_id == null)
    if (leftAbstract !== rightAbstract) return rightAbstract - leftAbstract
    return right.session_date.localeCompare(left.session_date)
  })
  const anchorPair = anchorCandidates.length > 0 ? mapPairRow(anchorCandidates[0]) : null

  const uncoveredMaterial = vector?.practiceMaterials.find(
    (material) => vector.relevantPracticeMaterialIds.includes(material.id) && material.status !== "cubierto_minimo"
  ) ?? null

  if (uncoveredMaterial) {
    const task = buildTask({
      kind: "coverage_gap",
      subjectId: activeSlot.subject_id,
      weekNumber,
      vector,
      instruction: `Falta sembrar una dupla util en ${uncoveredMaterial.fileName}.`,
      material: {
        id: uncoveredMaterial.id,
        fileName: uncoveredMaterial.fileName,
        sessionDate: uncoveredMaterial.sessionDate,
        status: uncoveredMaterial.status,
        isCheckupDone: uncoveredMaterial.isCheckupDone,
      },
      pair: null,
      fallbackPair: anchorPair,
    })

    const nextState = await updateMobileReviewStatePair({ state, pair: anchorPair })
    return {
      state: nextState,
      activeSlot,
      task,
      pair: anchorPair,
      totalPairs: anchorPair ? 1 : 0,
      currentIndex: anchorPair ? 1 : 0,
      debugReason: anchorPair ? undefined : "no_valid_pairs",
    }
  }

  const coveredMaterial = vector?.practiceMaterials.find(
    (material) => vector.relevantPracticeMaterialIds.includes(material.id) && material.status === "cubierto_minimo"
  ) ?? null

  if (coveredMaterial) {
    const materialCandidates = allPairs.filter((row) => row.material_id === coveredMaterial.id)
    const selection = resolvePairSelection({
      state,
      candidates: materialCandidates,
      subjectId: activeSlot.subject_id,
      weekNumber,
      forceNext,
    })
    const pair = selection.selectedRow ? mapPairRow(selection.selectedRow) : null
    const task = buildTask({
      kind: "material_pair",
      subjectId: activeSlot.subject_id,
      weekNumber,
      vector,
      instruction: `Evalua el concepto mas util de ${coveredMaterial.fileName}.`,
      material: {
        id: coveredMaterial.id,
        fileName: coveredMaterial.fileName,
        sessionDate: coveredMaterial.sessionDate,
        status: coveredMaterial.status,
        isCheckupDone: coveredMaterial.isCheckupDone,
      },
      pair,
    })
    const nextState = await updateMobileReviewStatePair({ state, pair })
    return {
      state: nextState,
      activeSlot,
      task,
      pair,
      totalPairs: selection.totalPairs,
      currentIndex: selection.currentIndex,
      debugReason: selection.debugReason,
    }
  }

  if (anchorPair) {
    const task = buildTask({
      kind: "subject_anchor",
      subjectId: activeSlot.subject_id,
      weekNumber,
      vector,
      instruction: "Trabaja el ancla conceptual mas fuerte de esta materia.",
      material: null,
      pair: anchorPair,
    })
    const nextState = await updateMobileReviewStatePair({ state, pair: anchorPair })
    return {
      state: nextState,
      activeSlot,
      task,
      pair: anchorPair,
      totalPairs: 1,
      currentIndex: 1,
      debugReason: undefined,
    }
  }

  const gapTask = buildTask({
    kind: "coverage_gap",
    subjectId: activeSlot.subject_id,
    weekNumber,
    vector,
    instruction: vector?.startDate
      ? "Esta materia sigue sin cobertura auditiva minima util."
      : "Todavia no hay practica suficiente cargada para activar el vector de esta materia.",
    material: null,
    pair: null,
  })
  return {
    state,
    activeSlot,
    task: gapTask,
    pair: null,
    totalPairs: 0,
    currentIndex: 0,
    debugReason: "no_valid_pairs",
  }
}

export function withSignedAudioUrls(pair: MobileReviewPair, authQuery: string) {
  return {
    ...pair,
    questionAudioUrl: `/api/mobile/review/audio/${pair.questionEntryId}?${authQuery}`,
    answerAudioUrl: `/api/mobile/review/audio/${pair.answerEntryId}?${authQuery}`,
  }
}

export function withSignedTaskAudioUrls(task: MobileReviewTask, authQuery: string): MobileReviewTask {
  return {
    ...task,
    pair: task.pair ? withSignedAudioUrls(task.pair, authQuery) : null,
    fallbackPair: task.fallbackPair ? withSignedAudioUrls(task.fallbackPair, authQuery) : null,
  }
}

export async function loadMobileReviewAudio(entryId: number) {
  const rows = await sql`
    SELECT drive_file_id, drive_file_name, drive_mime_type
    FROM subject_day_entries
    WHERE id = ${entryId}
    LIMIT 1
  ` as Array<{ drive_file_id: string; drive_file_name: string; drive_mime_type: string }>

  const entry = rows[0]
  if (!entry) {
    return null
  }

  const file = isR2ObjectKey(entry.drive_file_id)
    ? await downloadR2Object(entry.drive_file_id)
    : await downloadDriveFile(entry.drive_file_id)

  return {
    buffer: file.buffer,
    mimeType: file.mimeType || entry.drive_mime_type || "audio/webm",
    fileName: entry.drive_file_name,
  }
}

export async function canAccessMobileReviewEntry(deviceId: string, entryId: number) {
  const resolved = await resolveMobileReviewPair({ deviceId })
  const allowedEntryIds = [
    resolved.task?.pair?.questionEntryId ?? null,
    resolved.task?.pair?.answerEntryId ?? null,
    resolved.task?.fallbackPair?.questionEntryId ?? null,
    resolved.task?.fallbackPair?.answerEntryId ?? null,
  ].filter((value): value is number => Number.isInteger(value))

  return allowedEntryIds.includes(entryId)
}

export async function logMobileReviewEvent(input: MobileReviewEventInput) {
  await sql`
    INSERT INTO mobile_review_events (
      device_id,
      subject_id,
      week_number,
      material_id,
      pair_id,
      task_kind,
      event_type,
      rating
    ) VALUES (
      ${input.deviceId},
      ${input.subjectId},
      ${input.weekNumber},
      ${input.materialId},
      ${input.pairId},
      ${input.taskKind},
      ${input.eventType},
      ${input.rating}
    )
  `
}

export async function getMobileReviewStatus(deviceId: string, now = new Date()) {
  const state = await getOrCreateMobileReviewState(deviceId)
  const activeSlot = await getActiveMobileReviewSlot(now)
  const weekNumber = getBuenosAiresWeekNumber(now)
  const subject = activeSlot ? getSubjectById(activeSlot.subject_id) : null

  return {
    deviceId: state.device_id,
    activeSlot: activeSlot
      ? {
          weekdayIndex: activeSlot.weekday_index,
          startTime: activeSlot.start_time,
          endTime: activeSlot.end_time,
          subjectId: activeSlot.subject_id,
          subjectName: subject?.name.replace(/\n/g, " ") || activeSlot.subject_id,
        }
      : null,
    subjectId: activeSlot?.subject_id ?? null,
    subjectName: subject?.name.replace(/\n/g, " ") ?? null,
    weekNumber,
    hasCurrentPair: Boolean(state.current_pair_id),
    currentPairId: state.current_pair_id,
  }
}

export function isMissingMobileReviewDependency(error: unknown) {
  return isMissingTable(error) || isMissingColumn(error)
}
