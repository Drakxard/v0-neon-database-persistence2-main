import { getErrorMessage, parseJsonResponse } from "@/lib/client/api"
import type { SubjectDayEntry } from "@/lib/study-types"

export async function fetchSubjectEntries(searchParams: URLSearchParams, fallback: string) {
  const response = await fetch(`/api/subject-day-entries?${searchParams.toString()}`)
  const payload = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, fallback))
  }

  return Array.isArray(payload) ? (payload as SubjectDayEntry[]) : []
}

export async function fetchFeaturedReviewEntries(subjectId: string) {
  const entries = await fetchSubjectEntries(
    new URLSearchParams({ subjectId }),
    "No se pudieron cargar los destacados."
  )

  return entries.filter((entry) => entry.is_featured).sort((left, right) => {
    if (left.week_number !== right.week_number) return left.week_number - right.week_number
    return left.session_date.localeCompare(right.session_date)
  })
}

export async function fetchPracticeWeekEntries(subjectId: string, weekNumber: number, signal?: AbortSignal) {
  const searchParams = new URLSearchParams({
    subjectId,
    weekNumber: String(weekNumber),
  })
  const response = await fetch(`/api/subject-day-entries?${searchParams.toString()}`, {
    signal,
  })
  const payload = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, "No se pudieron cargar las dudas de practica."))
  }

  return Array.isArray(payload) ? (payload as SubjectDayEntry[]) : []
}
