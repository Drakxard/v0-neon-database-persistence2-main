export const INSCREEN_ROOT_PREFIX = "InSreen"
export const INSCREEN_EXISTING_SUBJECT_ACTIVATION_DATE = "2026-08-10"
export const INSCREEN_TIME_ZONE = "America/Argentina/Buenos_Aires"

export type InscreenStageState = {
  currentStage: number
  nextTransitionDate: string
}

function parseUtcDate(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number)
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1, 12))
}

function formatUtcDate(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`
}

export function addDateKeyDays(dateKey: string, days: number) {
  const date = parseUtcDate(dateKey)
  date.setUTCDate(date.getUTCDate() + days)
  return formatUtcDate(date)
}

export function getDateKeyWeekday(dateKey: string) {
  const jsDay = parseUtcDate(dateKey).getUTCDay()
  return jsDay === 0 ? 6 : jsDay - 1
}

export function firstWeekdayOnOrAfter(dateKey: string, targetWeekday: number) {
  const normalizedWeekday = Math.max(0, Math.min(6, Math.trunc(targetWeekday)))
  const currentWeekday = getDateKeyWeekday(dateKey)
  return addDateKeyDays(dateKey, (normalizedWeekday - currentWeekday + 7) % 7)
}

export function nextStrictWeekdayAfter(dateKey: string, targetWeekday: number) {
  const first = firstWeekdayOnOrAfter(dateKey, targetWeekday)
  return first === dateKey ? addDateKeyDays(first, 7) : first
}

export function createInitialInscreenStage(activationDate: string, targetWeekday: number): InscreenStageState {
  const firstBoundary = firstWeekdayOnOrAfter(activationDate, targetWeekday)
  return {
    currentStage: 1,
    nextTransitionDate: addDateKeyDays(firstBoundary, 7),
  }
}

export function advanceInscreenStage(
  state: InscreenStageState,
  currentDate: string
): InscreenStageState {
  if (currentDate < state.nextTransitionDate) return state

  const current = parseUtcDate(currentDate).getTime()
  const next = parseUtcDate(state.nextTransitionDate).getTime()
  const elapsedDays = Math.floor((current - next) / 86_400_000)
  const increments = Math.floor(elapsedDays / 7) + 1
  return {
    currentStage: state.currentStage + increments,
    nextTransitionDate: addDateKeyDays(state.nextTransitionDate, increments * 7),
  }
}

export function getDateKeyInTimeZone(date = new Date(), timeZone = INSCREEN_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

export function normalizeInscreenSubjectSegment(value: string, fallback = "materia") {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "")
    .toLowerCase()
  return normalized || fallback
}

export function normalizeInscreenPageText(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

export function normalizeInscreenTitle(value: string) {
  return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim()
}

export function resolveInscreenRelativeDayDate(nextTransitionDate: string, day: number) {
  if (!Number.isInteger(day) || day < 0 || day > 6) {
    throw new Error("INSCREEN_DAY_OUT_OF_RANGE")
  }
  const stageStartDate = addDateKeyDays(nextTransitionDate, -7)
  return addDateKeyDays(stageStartDate, 6 - day)
}
