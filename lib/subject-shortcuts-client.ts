import { requireOkJson } from "@/lib/client/api"
import type { SubjectShortcutKey, SubjectShortcuts } from "@/lib/study-types"

export function getEmptySubjectShortcuts(subjectId = ""): SubjectShortcuts {
  return {
    subjectId,
    eFich: null,
    figma: null,
  }
}

export async function fetchSubjectShortcuts(subjectId: string) {
  const searchParams = new URLSearchParams({ subjectId })
  const response = await fetch(`/api/subject-shortcuts?${searchParams.toString()}`, {
    cache: "no-store",
  })

  return requireOkJson<SubjectShortcuts>(response, "No se pudieron cargar los accesos directos de la materia.")
}

export async function updateSubjectShortcut(input: {
  subjectId: string
  shortcutKey: SubjectShortcutKey
  url: string
}) {
  const response = await fetch("/api/subject-shortcuts", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })

  return requireOkJson<SubjectShortcuts>(response, "No se pudo guardar el acceso directo.")
}
