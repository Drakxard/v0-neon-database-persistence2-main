import { requireOkJson } from "@/lib/client/api"
import type { SubjectSynthesisSubjectPayload } from "@/lib/study-types"

function buildSearchParams(subjectId: string, weekNumber: number) {
  return new URLSearchParams({
    subjectId,
    weekNumber: String(weekNumber),
  }).toString()
}

export async function fetchSubjectSynthesisMaterials(subjectId: string, weekNumber: number) {
  const response = await fetch(`/api/subject-synthesis-materials?${buildSearchParams(subjectId, weekNumber)}`, {
    cache: "no-store",
  })

  return requireOkJson<SubjectSynthesisSubjectPayload>(response, "No se pudo cargar la sintesis por archivo.")
}

export async function saveSubjectSynthesisMaterials(input: {
  subjectId: string
  weekNumber: number
  items: Array<{
    subjectDayMaterialId: number
    exerciseScopeText: string
    exerciseSolvedCount: number
    exerciseTotalCount: number
  }>
}) {
  const response = await fetch("/api/subject-synthesis-materials", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })

  return requireOkJson<SubjectSynthesisSubjectPayload>(response, "No se pudo guardar la sintesis por archivo.")
}
