import { neon } from "@neondatabase/serverless"

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
  question_entry_id: number
  question_title: string | null
  answer_entry_id: number
  answer_title: string | null
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

async function selectPairCandidate(params: {
  subjectId: string
  weekNumber: number
  excludePairId?: string | null
}) {
  const { subjectId, weekNumber, excludePairId } = params

  const preferredRows = await sql`
    SELECT
      question.pair_id,
      question.subject_id,
      question.week_number,
      question.session_date,
      question.id AS question_entry_id,
      question.custom_title AS question_title,
      answer.id AS answer_entry_id,
      answer.custom_title AS answer_title
    FROM subject_day_entries AS question
    INNER JOIN subject_day_entries AS answer
      ON answer.pair_id = question.pair_id
    WHERE question.pair_id IS NOT NULL
      AND question.pair_role = 'question'
      AND answer.pair_role = 'answer'
      AND question.subject_id = ${subjectId}
      AND answer.subject_id = question.subject_id
      AND question.week_number = ${weekNumber}
      AND answer.week_number = question.week_number
      AND question.pair_id <> ${excludePairId ?? ""}
    ORDER BY RANDOM()
    LIMIT 1
  ` as PairRow[]

  if (preferredRows[0]) return preferredRows[0]

  const fallbackRows = await sql`
    SELECT
      question.pair_id,
      question.subject_id,
      question.week_number,
      question.session_date,
      question.id AS question_entry_id,
      question.custom_title AS question_title,
      answer.id AS answer_entry_id,
      answer.custom_title AS answer_title
    FROM subject_day_entries AS question
    INNER JOIN subject_day_entries AS answer
      ON answer.pair_id = question.pair_id
    WHERE question.pair_id IS NOT NULL
      AND question.pair_role = 'question'
      AND answer.pair_role = 'answer'
      AND question.subject_id = ${subjectId}
      AND answer.subject_id = question.subject_id
      AND question.week_number = ${weekNumber}
      AND answer.week_number = question.week_number
    ORDER BY RANDOM()
    LIMIT 1
  ` as PairRow[]

  return fallbackRows[0] ?? null
}

export async function resolveMobileReviewPair(params: {
  deviceId: string
  forceNext?: boolean
  now?: Date
}) {
  const { deviceId, forceNext = false, now = new Date() } = params
  const state = await getOrCreateMobileReviewState(deviceId)
  const activeSlot = await getActiveMobileReviewSlot(now)
  if (!activeSlot) {
    return { state, activeSlot: null, pair: null as MobileReviewPair | null }
  }

  const weekNumber = getBuenosAiresWeekNumber(now)

  let selectedRow: PairRow | null = null
  if (!forceNext && state.current_pair_id && state.current_subject_id === activeSlot.subject_id && state.current_week_number === weekNumber) {
    const existingRows = await sql`
      SELECT
        question.pair_id,
        question.subject_id,
        question.week_number,
        question.session_date,
        question.id AS question_entry_id,
        question.custom_title AS question_title,
        answer.id AS answer_entry_id,
        answer.custom_title AS answer_title
      FROM subject_day_entries AS question
      INNER JOIN subject_day_entries AS answer
        ON answer.pair_id = question.pair_id
      WHERE question.pair_id = ${state.current_pair_id}
        AND question.pair_role = 'question'
        AND answer.pair_role = 'answer'
      LIMIT 1
    ` as PairRow[]
    selectedRow = existingRows[0] ?? null
  }

  if (!selectedRow) {
    selectedRow = await selectPairCandidate({
      subjectId: activeSlot.subject_id,
      weekNumber,
      excludePairId: forceNext ? state.current_pair_id : null,
    })
  }

  if (!selectedRow) {
    return { state, activeSlot, pair: null as MobileReviewPair | null }
  }

  const updatedRows = await sql`
    UPDATE mobile_review_state
    SET
      current_pair_id = ${selectedRow.pair_id},
      current_subject_id = ${selectedRow.subject_id},
      current_week_number = ${selectedRow.week_number},
      updated_at = NOW()
    WHERE device_id = ${state.device_id}
    RETURNING device_id, current_pair_id, current_subject_id, current_week_number, updated_at
  ` as MobileReviewStateRow[]

  return {
    state: updatedRows[0] ?? state,
    activeSlot,
    pair: mapPairRow(selectedRow),
  }
}

export function withSignedAudioUrls(pair: MobileReviewPair, authQuery: string) {
  return {
    ...pair,
    questionAudioUrl: `/api/mobile/review/audio/${pair.questionEntryId}?${authQuery}`,
    answerAudioUrl: `/api/mobile/review/audio/${pair.answerEntryId}?${authQuery}`,
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
  const state = await getOrCreateMobileReviewState(deviceId)
  if (!state.current_pair_id) {
    return false
  }

  const rows = await sql`
    SELECT 1
    FROM subject_day_entries
    WHERE id = ${entryId}
      AND pair_id = ${state.current_pair_id}
      AND pair_role IN ('question', 'answer')
    LIMIT 1
  ` as Array<{ "?column?": number }>

  return rows.length > 0
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
