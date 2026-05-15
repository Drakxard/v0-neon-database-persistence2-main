const HOME_SUBJECT_WEEKDAY: Partial<Record<string, number>> = {
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
  const daysUntil = (targetWeekday - currentWeekday + 7) % 7

  return {
    daysUntil,
    targetWeekday,
  }
}
