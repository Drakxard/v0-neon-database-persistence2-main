import { requireOkJson } from "@/lib/client/api"
import { getLocalSynthesisProgress, saveLocalSynthesisProgress } from "@/lib/local-workspace-data"
import { isLocalStorageMode } from "@/lib/storage-mode"
import type { SubjectSynthesisSubjectPayload } from "@/lib/study-types"

function buildSearchParams(subjectId: string, weekNumber: number) {
  return new URLSearchParams({
    subjectId,
    weekNumber: String(weekNumber),
  }).toString()
}

export async function fetchSubjectSynthesisMaterials(subjectId: string, weekNumber: number) {
  if (isLocalStorageMode()) {
    const [materialsResponse, entriesResponse] = await Promise.all([
      fetch(`/api/subject-day-materials?${new URLSearchParams({ subjectId, weekNumber: String(weekNumber), scope: "week" })}`, {
        cache: "no-store",
      }),
      fetch(`/api/subject-day-entries?${new URLSearchParams({ subjectId, weekNumber: String(weekNumber) })}`, {
        cache: "no-store",
      }),
    ])

    const materials = await requireOkJson<any[]>(materialsResponse, "No se pudo cargar la sintesis por archivo.")
    const entries = await requireOkJson<any[]>(entriesResponse, "No se pudo cargar la sintesis por archivo.")
    const progress = await getLocalSynthesisProgress(subjectId, weekNumber)

    return {
      subjectId,
      weekNumber,
      materials,
      entries,
      legacySummary: {
        subjectId,
        weekNumber,
        exerciseSolvedCount: 0,
        exerciseTotalCount: 0,
        exerciseSkippedText: null,
        updatedAt: null,
      },
      materialProgress: Array.isArray(progress) ? progress : [],
    } satisfies SubjectSynthesisSubjectPayload
  }

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
  if (isLocalStorageMode()) {
    await saveLocalSynthesisProgress(input.subjectId, input.weekNumber, input.items)
    return fetchSubjectSynthesisMaterials(input.subjectId, input.weekNumber)
  }

  const response = await fetch("/api/subject-synthesis-materials", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })

  return requireOkJson<SubjectSynthesisSubjectPayload>(response, "No se pudo guardar la sintesis por archivo.")
}
