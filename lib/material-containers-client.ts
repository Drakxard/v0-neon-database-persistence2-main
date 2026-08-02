import { requireOkJson } from "@/lib/client/api"
import type { SubjectMaterialContainer } from "@/lib/study-types"

export async function fetchSubjectMaterialContainers(subjectId: string) {
  return requireOkJson<SubjectMaterialContainer[]>(
    await fetch(`/api/subject-material-containers?${new URLSearchParams({ subjectId })}`, { cache: "no-store" }),
    "No se pudieron cargar los contenedores."
  )
}

export async function createSubjectMaterialContainer(subjectId: string, name: string) {
  return requireOkJson<SubjectMaterialContainer>(
    await fetch("/api/subject-material-containers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subjectId, name }),
    }),
    "No se pudo crear el contenedor."
  )
}

export async function renameSubjectMaterialContainer(id: number, name: string) {
  return requireOkJson<SubjectMaterialContainer>(
    await fetch(`/api/subject-material-containers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    }),
    "No se pudo renombrar el contenedor."
  )
}

export async function setSubjectMaterialContainerPinned(id: number, isPinned: boolean) {
  return requireOkJson<SubjectMaterialContainer>(
    await fetch(`/api/subject-material-containers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isPinned }),
    }),
    "No se pudo fijar el contenedor."
  )
}

export async function moveSubjectMaterialContainer(id: number, move: "up" | "down") {
  return requireOkJson<SubjectMaterialContainer>(
    await fetch(`/api/subject-material-containers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ move }),
    }),
    "No se pudo ordenar el contenedor."
  )
}

export async function removeSubjectMaterialContainer(id: number) {
  return requireOkJson<{ deleted: boolean; materialCount: number }>(
    await fetch(`/api/subject-material-containers/${id}`, { method: "DELETE" }),
    "No se pudo eliminar el contenedor."
  )
}
