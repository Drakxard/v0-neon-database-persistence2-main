export type SubjectDefinition = {
  id: string
  name: string
  color: string
  index: number
}

export const SUBJECTS: SubjectDefinition[] = [
  { id: "algebra", name: "Algebra 2", color: "#0098C8", index: 0 },
  { id: "calculo2", name: "Calculo 2", color: "#2563eb", index: 1 },
  { id: "calculo3", name: "Calculo 3", color: "#ea580c", index: 2 },
  { id: "fisica", name: "Fisica 1", color: "#dc2626", index: 3 },
  { id: "logica", name: "Logica y\ncomputabilidad", color: "#16a34a", index: 4 },
  { id: "probabilidad", name: "Probabilidad y\nEstadistica", color: "#a855f7", index: 5 },
]

export const SUBJECT_IDS = SUBJECTS.map((subject) => subject.id)

export const SUBJECT_ID_TO_INDEX = Object.fromEntries(
  SUBJECTS.map((subject) => [subject.id, subject.index])
) as Record<string, number>

export const SUBJECT_INDEX_TO_ID = Object.fromEntries(
  SUBJECTS.map((subject) => [subject.index, subject.id])
) as Record<number, string>

export function isValidSubjectId(subjectId: string) {
  return SUBJECT_IDS.includes(subjectId)
}

export function getSubjectById(subjectId: string) {
  return SUBJECTS.find((subject) => subject.id === subjectId) ?? null
}

export function normalizeAllowedSubjectIds(subjectIds: string[]) {
  const normalized = subjectIds
    .map((subjectId) => String(subjectId || "").trim())
    .filter((subjectId) => isValidSubjectId(subjectId))

  return Array.from(new Set(normalized))
}

export function getSubjectIdFromIndex(index: number | null | undefined) {
  if (!Number.isInteger(index)) return null
  return SUBJECT_INDEX_TO_ID[index as number] ?? null
}

export function getSubjectIndexFromId(subjectId: string) {
  return SUBJECT_ID_TO_INDEX[subjectId] ?? null
}
