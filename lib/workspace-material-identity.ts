import { createLocalSubjectDirectoryName } from "./local-subject-catalog.ts"

export type WorkspaceMaterialIdentity = {
  id: number
  subjectId: string
  sessionDate: string
  weekNumber: number
  materialType?: "practice" | "theory"
  workspaceFileId?: string | null
}

export function validateWorkspaceMaterialIdentity(material: WorkspaceMaterialIdentity) {
  const workspaceFileId = material.workspaceFileId || ""
  if (!workspaceFileId.startsWith("workspace://")) {
    return `El material ${material.id} no tiene un identificador de archivo local válido.`
  }

  const segments = workspaceFileId.slice("workspace://".length).split("/").filter(Boolean)
  const expectedTypeDirectory = material.materialType === "theory" ? "teoria" : "practica"
  const expectedSubjectDirectory = createLocalSubjectDirectoryName(material.subjectId)
  const matches =
    segments.length === 5 &&
    segments[0] === expectedTypeDirectory &&
    segments[1] === expectedSubjectDirectory &&
    segments[2] === `week-${material.weekNumber}` &&
    segments[3] === material.sessionDate &&
    Boolean(segments[4])

  return matches
    ? ""
    : `La ruta local del material ${material.id} no coincide con ${material.subjectId}, semana ${material.weekNumber} y ${material.sessionDate}.`
}
