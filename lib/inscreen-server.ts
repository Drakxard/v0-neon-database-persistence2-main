import type { AuthSession } from "@/lib/authz"
import {
  advanceInscreenStage,
  createInitialInscreenStage,
  getDateKeyInTimeZone,
  INSCREEN_EXISTING_SUBJECT_ACTIVATION_DATE,
  INSCREEN_ROOT_PREFIX,
  nextStrictWeekdayAfter,
  normalizeInscreenSubjectSegment,
} from "@/lib/inscreen"
import { RemoteFileNotFoundError } from "@/lib/remote-file-errors"
import {
  downloadR2Object,
  isR2PreconditionFailedError,
  listR2ObjectsByPrefix,
  uploadR2Object,
} from "@/lib/r2"

const INSCREEN_MANIFEST_PREFIX = "manifests/inscreen"
const MAX_MANIFEST_RETRIES = 12

export class InscreenHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export type InscreenMaterialContext = {
  materialId: number
  subjectId: string
  subjectName: string
  subjectSegment: string
  fileName: string
  contentRevision: string
  targetWeekday: number
  activationDate: string
}

export type InscreenCapture = {
  id: string
  pageNumber: number
  stageNumber: number
  subjectSegment: string
  status: "pending" | "complete"
  sourceType: "pdf" | "clipboard" | "marker"
  r2Key: string | null
  createdAt: string
  updatedAt: string
}

export type InscreenTranslationBatch = {
  status: "pending" | "complete"
  r2Key: string | null
  entryCount: number
  updatedAt: string
}

export type InscreenMaterialManifest = {
  version: 1
  materialId: number
  subjectId: string
  contentRevision: string
  captures: Record<string, InscreenCapture>
  consumedAnnotationIds: string[]
  focusedNotes: Record<string, {
    status: "pending" | "complete"
    annotationIds: string[]
    r2Key: string | null
    updatedAt: string
  }>
  translationBatches: Record<string, InscreenTranslationBatch>
  updatedAt: string
}

type InscreenStageManifest = {
  version: 1
  subjectId: string
  targetWeekday: number
  currentStage: number
  activationDate: string
  nextTransitionDate: string
  updatedAt: string
}

type ManifestSnapshot<T> = { value: T; etag: string | null }

function nowIso() {
  return new Date().toISOString()
}

function sanitizeManifestSegment(value: string, fallback = "local") {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, 180) || fallback
}

function normalizeActivationDate(value: unknown) {
  const candidate = String(value || "").slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) && candidate > INSCREEN_EXISTING_SUBJECT_ACTIVATION_DATE
    ? candidate
    : INSCREEN_EXISTING_SUBJECT_ACTIVATION_DATE
}

function normalizeRevision(value: unknown) {
  const revision = String(value || "").trim()
  if (!revision || revision.length > 500) {
    throw new InscreenHttpError(400, "Invalid PDF revision")
  }
  return revision
}

export function parseInscreenMaterialContext(input: Record<string, unknown> | URLSearchParams) {
  const get = (key: string) => input instanceof URLSearchParams ? input.get(key) : input[key]
  const materialId = Number.parseInt(String(get("materialId") || ""), 10)
  const subjectId = String(get("subjectId") || "").trim()
  const subjectName = String(get("subjectName") || "").trim()
  const fileName = String(get("fileName") || "").trim()
  const contentRevision = normalizeRevision(get("contentRevision"))
  const targetWeekday = Number.parseInt(String(get("targetWeekday") ?? ""), 10)

  if (!Number.isInteger(materialId) || materialId <= 0 || !subjectId || !subjectName || !fileName) {
    throw new InscreenHttpError(400, "Invalid material context")
  }
  if (!Number.isInteger(targetWeekday) || targetWeekday < 0 || targetWeekday > 6) {
    throw new InscreenHttpError(400, "Invalid subject weekday")
  }

  return {
    materialId,
    subjectId: subjectId.slice(0, 180),
    subjectName: subjectName.slice(0, 300),
    subjectSegment: normalizeInscreenSubjectSegment(subjectName, normalizeInscreenSubjectSegment(subjectId)),
    fileName: fileName.slice(0, 500),
    contentRevision,
    targetWeekday,
    activationDate: normalizeActivationDate(get("activationDate")),
  } satisfies InscreenMaterialContext
}

function materialManifestKey(context: InscreenMaterialContext) {
  const material = sanitizeManifestSegment(`${context.subjectId}-${context.materialId}`, "material")
  const revision = sanitizeManifestSegment(context.contentRevision, "revision")
  return `${INSCREEN_MANIFEST_PREFIX}/materials/${material}/${revision}.json`
}

function stageManifestKey(session: AuthSession, subjectId: string) {
  return `${INSCREEN_MANIFEST_PREFIX}/stages/${sanitizeManifestSegment(session.email)}/${sanitizeManifestSegment(subjectId, "subject")}.json`
}

function emptyMaterialManifest(context: InscreenMaterialContext): InscreenMaterialManifest {
  return {
    version: 1,
    materialId: context.materialId,
    subjectId: context.subjectId,
    contentRevision: context.contentRevision,
    captures: {},
    consumedAnnotationIds: [],
    focusedNotes: {},
    translationBatches: {},
    updatedAt: nowIso(),
  }
}

export async function readInscreenJson<T>(objectKey: string, fallback: T): Promise<ManifestSnapshot<T>> {
  try {
    const downloaded = await downloadR2Object(objectKey)
    return {
      value: JSON.parse(downloaded.buffer.toString("utf8")) as T,
      etag: downloaded.etag,
    }
  } catch (error) {
    if (error instanceof RemoteFileNotFoundError) return { value: fallback, etag: null }
    throw error
  }
}

export async function updateInscreenJson<T>(params: {
  objectKey: string
  fallback: () => T
  mutate: (current: T) => T | Promise<T>
}) {
  for (let attempt = 0; attempt < MAX_MANIFEST_RETRIES; attempt += 1) {
    const snapshot = await readInscreenJson(params.objectKey, params.fallback())
    const next = await params.mutate(structuredClone(snapshot.value))
    try {
      await uploadR2Object({
        objectKey: params.objectKey,
        mimeType: "application/json; charset=utf-8",
        body: JSON.stringify(next, null, 2),
        ifMatch: snapshot.etag || undefined,
        ifNoneMatch: snapshot.etag ? undefined : "*",
      })
      return next
    } catch (error) {
      if (!isR2PreconditionFailedError(error)) throw error
    }
  }
  throw new InscreenHttpError(409, "El estado cambió al mismo tiempo; volvé a intentar.")
}

export async function readInscreenMaterialManifest(context: InscreenMaterialContext) {
  return readInscreenJson(materialManifestKey(context), emptyMaterialManifest(context))
}

export async function updateInscreenMaterialManifest(
  context: InscreenMaterialContext,
  mutate: (current: InscreenMaterialManifest) => InscreenMaterialManifest | Promise<InscreenMaterialManifest>
) {
  return updateInscreenJson({
    objectKey: materialManifestKey(context),
    fallback: () => emptyMaterialManifest(context),
    mutate: async (current) => {
      if (
        current.materialId !== context.materialId ||
        current.subjectId !== context.subjectId ||
        current.contentRevision !== context.contentRevision
      ) {
        throw new InscreenHttpError(409, "Material manifest mismatch")
      }
      current.translationBatches ??= {}
      const next = await mutate(current)
      next.updatedAt = nowIso()
      return next
    },
  })
}

export async function resolveInscreenStage(
  session: AuthSession,
  context: InscreenMaterialContext,
  currentDate = getDateKeyInTimeZone()
) {
  return updateInscreenJson<InscreenStageManifest>({
    objectKey: stageManifestKey(session, context.subjectId),
    fallback: () => {
      const initial = createInitialInscreenStage(context.activationDate, context.targetWeekday)
      return {
        version: 1,
        subjectId: context.subjectId,
        targetWeekday: context.targetWeekday,
        currentStage: initial.currentStage,
        activationDate: context.activationDate,
        nextTransitionDate: initial.nextTransitionDate,
        updatedAt: nowIso(),
      }
    },
    mutate: (current) => {
      const advanced = advanceInscreenStage({
        currentStage: current.currentStage,
        nextTransitionDate: current.nextTransitionDate,
      }, currentDate)
      const weekdayChanged = current.targetWeekday !== context.targetWeekday
      return {
        ...current,
        targetWeekday: context.targetWeekday,
        currentStage: advanced.currentStage,
        nextTransitionDate: weekdayChanged
          ? nextStrictWeekdayAfter(currentDate, context.targetWeekday)
          : advanced.nextTransitionDate,
        updatedAt: nowIso(),
      }
    },
  })
}

export async function uploadNextInscreenText(params: {
  subjectSegment: string
  stageNumber: number
  kind: "pagina" | "material" | "transcripcion"
  body: string
  metadata: Record<string, string>
}) {
  const prefix = `${INSCREEN_ROOT_PREFIX}/${params.subjectSegment}/${params.stageNumber}/${params.kind}/`

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const objects = await listR2ObjectsByPrefix(prefix)
    const lastId = objects.reduce((maximum, object) => {
      const fileName = object.key.slice(prefix.length)
      const match = /^(\d+)\.txt$/.exec(fileName)
      return match ? Math.max(maximum, Number.parseInt(match[1], 10)) : maximum
    }, 0)
    const nextId = lastId + 1
    const objectKey = `${prefix}${nextId}.txt`

    try {
      await uploadR2Object({
        objectKey,
        mimeType: "text/plain; charset=utf-8",
        body: params.body,
        metadata: params.metadata,
        ifNoneMatch: "*",
      })
      return { objectKey, id: nextId }
    } catch (error) {
      if (!isR2PreconditionFailedError(error)) throw error
    }
  }

  throw new Error("No se pudo reservar el siguiente identificador de R2.")
}

export function inscreenMetadata(context: InscreenMaterialContext, stageNumber: number) {
  return {
    "subject-id": context.subjectId,
    "pdf-name": context.fileName,
    "material-id": String(context.materialId),
    "content-revision": context.contentRevision,
    "stage-number": String(stageNumber),
  }
}

export function inscreenErrorResponse(error: unknown) {
  if (error instanceof InscreenHttpError) {
    return Response.json({ error: error.message }, { status: error.status })
  }
  return Response.json(
    { error: error instanceof Error ? error.message : "Inscreen request failed" },
    { status: 500 }
  )
}
