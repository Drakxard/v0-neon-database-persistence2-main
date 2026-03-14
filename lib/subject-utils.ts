export const WEEK_ONE_START = new Date(2026, 2, 14)
export const WEEK_TWO_START = new Date(2026, 2, 23)

export const WEEKDAY_NAMES = ["Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado", "Domingo"]

export function getCurrentWeekNumber(today = new Date()): number {
  return getWeekNumberForDate(today)
}

export function normalizeDate(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function getWeekNumberForDate(input: Date): number {
  const current = normalizeDate(input)
  if (current < WEEK_ONE_START) return 0
  if (current < WEEK_TWO_START) return 1

  const msPerDay = 1000 * 60 * 60 * 24
  const diffDays = Math.floor((current.getTime() - WEEK_TWO_START.getTime()) / msPerDay)
  return Math.floor(diffDays / 7) + 2
}

export function formatDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

export function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number)
  return new Date(year, (month || 1) - 1, day || 1)
}

export function isFutureDateKey(dateKey: string, today = new Date()) {
  return normalizeDate(parseDateKey(dateKey)) > normalizeDate(today)
}

export function getWeekStartDate(weekNumber: number) {
  if (weekNumber <= 0) {
    const today = new Date()
    const current = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const jsDay = current.getDay()
    const mondayOffset = jsDay === 0 ? -6 : 1 - jsDay
    current.setDate(current.getDate() + mondayOffset)
    return current
  }

  if (weekNumber === 1) {
    return new Date(WEEK_ONE_START)
  }

  const start = new Date(WEEK_TWO_START)
  start.setDate(WEEK_TWO_START.getDate() + (weekNumber - 2) * 7)
  return start
}

export function getWeekDates(weekNumber: number) {
  const start = getWeekStartDate(weekNumber)
  const totalDays = weekNumber === 1 ? Math.round((WEEK_TWO_START.getTime() - WEEK_ONE_START.getTime()) / (1000 * 60 * 60 * 24)) : 7
  return Array.from({ length: totalDays }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return date
  })
}

export function getWeekDatesForDate(input: Date) {
  return getWeekDates(getWeekNumberForDate(input))
}

export function getWeekdayIndexFromDateKey(dateKey: string) {
  const date = parseDateKey(dateKey)
  const jsDay = date.getDay()
  return jsDay === 0 ? 6 : jsDay - 1
}

export function getWeekdayLabel(dateKey: string) {
  return WEEKDAY_NAMES[getWeekdayIndexFromDateKey(dateKey)] || ""
}
