const SYNTHESIS_THEORY_WEEKDAY: Partial<Record<string, number>> = {
  calculo3: 0,
  fisica: 0,
  probabilidad: 1,
  logica: 4,
}

const WEEKDAY_LABELS = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"]

function getWeekdayIndex(date: Date) {
  const jsDay = date.getDay()
  return jsDay === 0 ? 6 : jsDay - 1
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function getSynthesisTheoryWeekday(subjectId: string) {
  return SYNTHESIS_THEORY_WEEKDAY[subjectId] ?? null
}

export function getSynthesisCountdown(subjectId: string, referenceDate: Date) {
  const theoryWeekday = getSynthesisTheoryWeekday(subjectId)
  if (theoryWeekday == null) return null

  const countdownDate = startOfDay(referenceDate)
  const currentWeekday = getWeekdayIndex(countdownDate)
  const deadlineWeekday = (theoryWeekday + 6) % 7
  const daysUntil = (deadlineWeekday - currentWeekday + 7) % 7

  return {
    daysUntil,
    theoryWeekday,
    deadlineWeekday,
    weekdayLabel: WEEKDAY_LABELS[deadlineWeekday] ?? "",
  }
}
