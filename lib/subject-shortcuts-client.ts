import { requireOkJson } from "@/lib/client/api"
import { getDefaultSubjectShortcuts } from "@/lib/subject-shortcuts"
import type { SubjectShortcuts } from "@/lib/study-types"

export function getEmptySubjectShortcuts(subjectId = ""): SubjectShortcuts {
  return getDefaultSubjectShortcuts(subjectId)
}

export async function fetchSubjectShortcuts(subjectId: string) {
  const searchParams = new URLSearchParams({ subjectId })
  const response = await fetch(`/api/subject-shortcuts?${searchParams.toString()}`, {
    cache: "no-store",
  })

  return requireOkJson<SubjectShortcuts>(
    response,
    "No se pudieron cargar los accesos directos de la materia."
  )
}

export async function createSubjectShortcut(input: {
  subjectId: string
  label: string
}) {
  const response = await fetch("/api/subject-shortcuts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })

  return requireOkJson<SubjectShortcuts>(response, "No se pudo guardar el acceso directo.")
}

export async function updateSubjectShortcut(input: { subjectId: string; id: string; url: string }) {
  const response = await fetch("/api/subject-shortcuts", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  return requireOkJson<SubjectShortcuts>(response, "No se pudo guardar el acceso directo.")
}

export async function deleteSubjectShortcut(input: { subjectId: string; id: string }) {
  const response = await fetch("/api/subject-shortcuts", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })
  return requireOkJson<SubjectShortcuts>(response, "No se pudo borrar el acceso directo.")
}
