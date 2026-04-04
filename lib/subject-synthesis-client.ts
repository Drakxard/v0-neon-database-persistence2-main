import { requireOkJson } from "@/lib/client/api"
import type { SubjectSynthesisRecord } from "@/lib/study-types"

function buildSubjectSynthesisSearchParams(subjectId: string, weekNumber: number) {
  const searchParams = new URLSearchParams({
    subjectId,
    weekNumber: String(weekNumber),
  })

  return searchParams.toString()
}

export async function fetchSubjectSynthesis(subjectId: string, weekNumber: number) {
  const response = await fetch(`/api/subject-synthesis?${buildSubjectSynthesisSearchParams(subjectId, weekNumber)}`, {
    cache: "no-store",
  })

  return requireOkJson<SubjectSynthesisRecord>(response, "No se pudo cargar la sintesis semanal.")
}

export async function saveSubjectSynthesis(input: {
  subjectId: string
  weekNumber: number
  exerciseSolvedCount: number
  exerciseTotalCount: number
  exerciseSkippedText: string
}) {
  const response = await fetch("/api/subject-synthesis", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })

  return requireOkJson<SubjectSynthesisRecord>(response, "No se pudo guardar la sintesis semanal.")
}
