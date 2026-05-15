import { requireOkJson } from "@/lib/client/api"
import type { SubjectOpenCountRecord } from "@/lib/study-types"

export async function fetchSubjectOpenCounts(weekNumber: number) {
  const response = await fetch(`/api/subject-open-counts?weekNumber=${encodeURIComponent(String(weekNumber))}`)
  return requireOkJson<SubjectOpenCountRecord[]>(response, "No se pudo cargar el contador de aperturas.")
}

export async function recordSubjectOpenCount(input: {
  subjectId: string
  weekNumber: number
  hourKey: string
}) {
  const response = await fetch("/api/subject-open-counts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })

  return requireOkJson<SubjectOpenCountRecord>(response, "No se pudo registrar la apertura de la materia.")
}
