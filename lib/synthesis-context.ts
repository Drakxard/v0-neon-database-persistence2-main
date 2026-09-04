export const SYNTHESIS_MAX_SUBJECT_ID_LENGTH = 160
export const SYNTHESIS_MAX_WEEK_NUMBER = 9999
export const SYNTHESIS_RETURN_TOKEN_STORAGE_KEY = "inscreen:synthesis:return-token"

export type SynthesisContext = {
  subjectId: string
  weekNumber: number
}

const VALID_SUBJECT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export class InvalidSynthesisContextError extends Error {}

export function parseSynthesisContext(subjectIdInput: unknown, weekNumberInput: unknown): SynthesisContext {
  const subjectId = String(subjectIdInput ?? "").trim()
  const weekNumber = typeof weekNumberInput === "number"
    ? weekNumberInput
    : Number(String(weekNumberInput ?? "").trim())

  if (
    !subjectId ||
    subjectId.length > SYNTHESIS_MAX_SUBJECT_ID_LENGTH ||
    !VALID_SUBJECT_ID.test(subjectId)
  ) {
    throw new InvalidSynthesisContextError("La materia de Síntesis es inválida.")
  }
  if (!Number.isInteger(weekNumber) || weekNumber < 0 || weekNumber > SYNTHESIS_MAX_WEEK_NUMBER) {
    throw new InvalidSynthesisContextError("La semana de Síntesis es inválida.")
  }

  return { subjectId, weekNumber }
}

export function buildSynthesisLocalStorageKey(baseKey: string, context: SynthesisContext) {
  const normalized = parseSynthesisContext(context.subjectId, context.weekNumber)
  return `${baseKey}:${encodeURIComponent(normalized.subjectId)}:week-${normalized.weekNumber}`
}

export function buildSynthesisReturnTokenStorageKey(context: SynthesisContext) {
  return buildSynthesisLocalStorageKey(SYNTHESIS_RETURN_TOKEN_STORAGE_KEY, context)
}

export function buildSynthesisTreeObjectKey(context: SynthesisContext) {
  const normalized = parseSynthesisContext(context.subjectId, context.weekNumber)
  return `manifests/inscreen/sintesis/by-subject/${normalized.subjectId}/semana-${normalized.weekNumber}/tree-v1.json`
}

export function buildSynthesisWorkspaceObjectKey(context: SynthesisContext) {
  const normalized = parseSynthesisContext(context.subjectId, context.weekNumber)
  return `manifests/inscreen/sintesis/by-subject/${normalized.subjectId}/semana-${normalized.weekNumber}/synthesis-v2.json`
}
