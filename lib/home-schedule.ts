export const HOME_SUBJECT_WEEKDAY: Partial<Record<string, number>> = {
  calculo2: 0,
  algebra: 0,
  calculo3: 0,
  fisica: 0,
  probabilidad: 1,
  logica: 4,
}

export function getHomeSubjectCountdown(subjectId: string, referenceDate: Date) {
  const targetWeekday = HOME_SUBJECT_WEEKDAY[subjectId]
  if (targetWeekday == null) return null

  const date = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate())
  const jsDay = date.getDay()
  const currentWeekday = jsDay === 0 ? 6 : jsDay - 1
  let daysUntil = 0

  if (currentWeekday === targetWeekday) {
    daysUntil = 0
  } else if (currentWeekday < targetWeekday) {
    daysUntil = targetWeekday - currentWeekday
  } else {
    daysUntil = 7 - currentWeekday + targetWeekday
  }

  return {
    daysUntil,
    targetWeekday,
  }
}
