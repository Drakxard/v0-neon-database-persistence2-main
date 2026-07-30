import { getSubjectById, SUBJECTS } from "@/lib/subjects"
import { isLocalStorageMode } from "@/lib/storage-mode"
import {
  deleteR2Object,
  downloadR2Object,
  getR2ObjectMetadatas,
  getR2ObjectMetadata,
  isR2ObjectKey,
  listR2ObjectsByPrefix,
  uploadR2Object,
} from "@/lib/r2"
import { RemoteFileNotFoundError } from "@/lib/remote-file-errors"
import { formatDateKey, getWeekDates, getWeekdayIndexFromDateKey, WEEKDAY_NAMES } from "@/lib/subject-utils"

export type MaterialType = "theory" | "practice"

export type LocalSubjectDayMaterial = {
  id: number
  subject_id: string
  week_number: number
  session_date: string
  weekday_index: number
  material_type: MaterialType
  container_id?: number | null
  order_index: number
  file_name: string
  drive_file_id: string
  drive_mime_type: string
  drive_web_view_link: string
  is_checkup_done: boolean
  created_at: string
  updated_at: string
}

export type LocalSubjectDayEntryLink = {
  id: number
  label: string
  url: string
}

export type LocalEntryAudioPosition = {
  page_num: number
  xp: number
  yp: number
}

export type LocalSubjectDayEntry = {
  id: number
  subject_day_material_id: number | null
  subject_id: string
  week_number: number
  session_date: string
  weekday_index: number
  order_index: number
  transcript_text: string
  drive_file_id: string
  drive_file_name: string
  drive_mime_type: string
  drive_web_view_link: string
  answer_text: string | null
  custom_title: string | null
  practice_state: "erre" | null
  pair_id: string | null
  pair_role: "question" | "answer" | null
  is_featured: boolean
  created_at: string
  updated_at: string
  external_links: LocalSubjectDayEntryLink[]
  audio_position: LocalEntryAudioPosition | null
}

type MaterialManifest = {
  version: 1
  subjectId: string
  weekNumber: number
  materials: LocalSubjectDayMaterial[]
}

type EntryManifest = {
  version: 1
  subjectId: string
  weekNumber: number
  entries: LocalSubjectDayEntry[]
}

type CronogramaManifest = {
  version: 1
  fileName: string
  driveFileId: string
  driveMimeType: string
  updatedAt: string
}

const MATERIAL_MANIFEST_PREFIX = "manifests/materials/"
const ENTRY_MANIFEST_PREFIX = "manifests/entries/"
const CRONOGRAMA_MANIFEST_KEY = "manifests/cronograma/current.json"

function assertLegacyR2LocalManifestsDisabled(_operation: string) {
  if (isLocalStorageMode()) {
    throw new Error("Manifiestos R2 deshabilitados en modo local. Usa la carpeta workspace del navegador.")
  }
}

function sanitizePathSegment(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "archivo"
}

function subjectNameToId(segment: string) {
  const normalizedSegment = sanitizePathSegment(segment)
  return SUBJECTS.find((subject) => sanitizePathSegment(subject.name.replace(/\n/g, " ")) === normalizedSegment)?.id ?? null
}

function materialManifestKey(subjectId: string, weekNumber: number) {
  return `${MATERIAL_MANIFEST_PREFIX}${subjectId}/week-${weekNumber}.json`
}

function entryManifestKey(subjectId: string, weekNumber: number) {
  return `${ENTRY_MANIFEST_PREFIX}${subjectId}/week-${weekNumber}.json`
}

function nextLocalId() {
  return Number(`${Date.now()}${Math.floor(Math.random() * 100).toString().padStart(2, "0")}`)
}

async function readJsonManifest<T>(objectKey: string) {
  assertLegacyR2LocalManifestsDisabled("readJsonManifest")
  try {
    const payload = await downloadR2Object(objectKey)
    return JSON.parse(payload.buffer.toString("utf8")) as T
  } catch (error) {
    if (error instanceof RemoteFileNotFoundError) {
      return null
    }
    throw error
  }
}

async function writeJsonManifest(objectKey: string, payload: unknown) {
  assertLegacyR2LocalManifestsDisabled("writeJsonManifest")
  await uploadR2Object({
    objectKey,
    mimeType: "application/json",
    body: JSON.stringify(payload, null, 2),
  })
}

function normalizeSessionDateKey(sessionDate: string | Date) {
  if (sessionDate instanceof Date) {
    return `${sessionDate.getFullYear()}-${String(sessionDate.getMonth() + 1).padStart(2, "0")}-${String(sessionDate.getDate()).padStart(2, "0")}`
  }

  return sessionDate.includes("T") ? sessionDate.slice(0, 10) : sessionDate
}

function normalizeUploadedPdfFileName(fileName: string) {
  const trimmed = fileName.trim()
  if (!trimmed) return ""
  return trimmed.toLowerCase().endsWith(".pdf") ? trimmed : `${trimmed}.pdf`
}

function normalizeMaterialType(value: string | undefined) {
  return value === "practice" || value === "theory" ? value : null
}

function inferLegacyMaterialType(fileName: string) {
  const normalizedName = sanitizePathSegment(fileName)
  if (
    normalizedName.includes("guia") ||
    normalizedName.includes("resp") ||
    normalizedName.includes("ejer") ||
    normalizedName.includes("pract")
  ) {
    return "practice" as const
  }

  return "theory" as const
}

function getLegacySessionDateFromWeekAndDay(weekNumber: number, weekdayNameSegment: string) {
  const dayIndex = WEEKDAY_NAMES.findIndex((weekday) => sanitizePathSegment(weekday) === sanitizePathSegment(weekdayNameSegment))
  if (dayIndex < 0) return null

  const weekDates = getWeekDates(weekNumber)
  const sessionDate = weekDates[dayIndex]
  return sessionDate ? formatDateKey(sessionDate) : null
}

function buildMaterialFromR2Metadata(params: {
  objectKey: string
  name: string
  mimeType: string
  metadata: Record<string, string>
  fallbackOrderIndex: number
}) {
  const subjectId = String(params.metadata["subject-id"] || "").trim()
  const weekNumber = Number.parseInt(String(params.metadata["week-number"] || ""), 10)
  const sessionDate = String(params.metadata["session-date"] || "").trim()
  const weekdayIndex = Number.parseInt(String(params.metadata["weekday-index"] || ""), 10)
  const materialType = normalizeMaterialType(params.metadata["material-type"])
  const originalFileName = normalizeUploadedPdfFileName(String(params.metadata["original-file-name"] || "").trim() || params.name)

  if (!subjectId || !Number.isInteger(weekNumber) || !sessionDate || !Number.isInteger(weekdayIndex) || !materialType || !originalFileName) {
    return null
  }

  const createdAt = new Date().toISOString()
  return {
    id: nextLocalId(),
    subject_id: subjectId,
    week_number: weekNumber,
    session_date: normalizeSessionDateKey(sessionDate),
    weekday_index: weekdayIndex,
    material_type: materialType,
    order_index: params.fallbackOrderIndex,
    file_name: originalFileName,
    drive_file_id: params.objectKey,
    drive_mime_type: params.mimeType,
    drive_web_view_link: "",
    is_checkup_done: false,
    created_at: createdAt,
    updated_at: createdAt,
  } satisfies LocalSubjectDayMaterial
}

function buildMaterialFromLegacyKey(params: {
  objectKey: string
  name: string
  mimeType: string
  fallbackOrderIndex: number
}) {
  const segments = params.objectKey.split("/")
  if (segments.length < 5) return null

  const subjectId = subjectNameToId(segments[1] || "")
  const weekMatch = /^semana-(\d+)$/.exec(segments[2] || "")
  const weekNumber = weekMatch ? Number.parseInt(weekMatch[1], 10) : Number.NaN
  const sessionDate = Number.isInteger(weekNumber) ? getLegacySessionDateFromWeekAndDay(weekNumber, segments[3] || "") : null
  const originalFileName = normalizeUploadedPdfFileName(params.name)
  const materialType = inferLegacyMaterialType(originalFileName)

  if (!subjectId || !Number.isInteger(weekNumber) || !sessionDate || !originalFileName) {
    return null
  }

  const createdAt = new Date().toISOString()
  return {
    id: nextLocalId(),
    subject_id: subjectId,
    week_number: weekNumber,
    session_date: sessionDate,
    weekday_index: getWeekdayIndexFromDateKey(sessionDate),
    material_type: materialType,
    order_index: params.fallbackOrderIndex,
    file_name: originalFileName,
    drive_file_id: params.objectKey,
    drive_mime_type: params.mimeType,
    drive_web_view_link: "",
    is_checkup_done: false,
    created_at: createdAt,
    updated_at: createdAt,
  } satisfies LocalSubjectDayMaterial
}

function sortMaterials(materials: LocalSubjectDayMaterial[]) {
  return [...materials].sort((left, right) => {
    if (left.session_date !== right.session_date) return left.session_date.localeCompare(right.session_date)
    if (left.material_type !== right.material_type) return left.material_type.localeCompare(right.material_type)
    if (left.order_index !== right.order_index) return left.order_index - right.order_index
    return left.id - right.id
  })
}

function sortEntries(entries: LocalSubjectDayEntry[]) {
  return [...entries].sort((left, right) => {
    if (left.session_date !== right.session_date) return left.session_date.localeCompare(right.session_date)
    if (left.is_featured !== right.is_featured) return left.is_featured ? -1 : 1
    if (left.order_index !== right.order_index) return left.order_index - right.order_index
    return left.id - right.id
  })
}

async function bootstrapMaterialManifest(subjectId: string, weekNumber: number) {
  const subject = getSubjectById(subjectId)
  if (!subject) {
    return {
      version: 1,
      subjectId,
      weekNumber,
      materials: [],
    } satisfies MaterialManifest
  }

  const prefix = `r2/${sanitizePathSegment(subject.name.replace(/\n/g, " "))}/semana-${weekNumber}/`
  const listedObjects = await listR2ObjectsByPrefix(prefix)
  const objectKeys = listedObjects.map((object) => object.key).filter((key) => isR2ObjectKey(key))
  if (objectKeys.length === 0) {
    return {
      version: 1,
      subjectId,
      weekNumber,
      materials: [],
    } satisfies MaterialManifest
  }

  const metadatas = await getR2ObjectMetadatas(objectKeys)
  const materials = metadatas
    .map<LocalSubjectDayMaterial | null>((metadata, index) => {
      if (metadata.mimeType !== "application/pdf") return null
      return (
        buildMaterialFromR2Metadata({
          objectKey: metadata.id,
          name: metadata.name,
          mimeType: metadata.mimeType,
          metadata: metadata.metadata ?? {},
          fallbackOrderIndex: index,
        }) ??
        buildMaterialFromLegacyKey({
          objectKey: metadata.id,
          name: metadata.name,
          mimeType: metadata.mimeType,
          fallbackOrderIndex: index,
        })
      )
    })
    .filter((material): material is LocalSubjectDayMaterial => material !== null)

  return {
    version: 1,
    subjectId,
    weekNumber,
    materials: sortMaterials(materials).map((material, index) => ({
      ...material,
      order_index: index,
    })),
  } satisfies MaterialManifest
}

export async function readMaterialManifest(subjectId: string, weekNumber: number) {
  const key = materialManifestKey(subjectId, weekNumber)
  const existing = await readJsonManifest<MaterialManifest>(key)
  if (existing) {
    return {
      ...existing,
      materials: sortMaterials(existing.materials ?? []),
    }
  }

  const bootstrapped = await bootstrapMaterialManifest(subjectId, weekNumber)
  if (bootstrapped.materials.length > 0) {
    await writeJsonManifest(key, bootstrapped)
  }
  return bootstrapped
}

export async function saveMaterialManifest(subjectId: string, weekNumber: number, materials: LocalSubjectDayMaterial[]) {
  const sortedMaterials = sortMaterials(materials)
  if (sortedMaterials.length === 0) {
    await deleteR2Object(materialManifestKey(subjectId, weekNumber))
    return {
      version: 1,
      subjectId,
      weekNumber,
      materials: [],
    } satisfies MaterialManifest
  }

  const manifest = {
    version: 1,
    subjectId,
    weekNumber,
    materials: sortedMaterials,
  } satisfies MaterialManifest
  await writeJsonManifest(materialManifestKey(subjectId, weekNumber), manifest)
  return manifest
}

export async function listLocalSubjectDayMaterials(scope: {
  subjectId: string
  weekNumber: number
  sessionDate?: string
  materialType?: MaterialType | null
}) {
  const manifest = await readMaterialManifest(scope.subjectId, scope.weekNumber)
  return manifest.materials.filter((material) => {
    if (scope.sessionDate && material.session_date !== scope.sessionDate) return false
    if (scope.materialType && material.material_type !== scope.materialType) return false
    return true
  })
}

export async function findLocalMaterialById(materialId: number) {
  const manifests = await listR2ObjectsByPrefix(MATERIAL_MANIFEST_PREFIX)
  for (const manifestObject of manifests) {
    const manifest = await readJsonManifest<MaterialManifest>(manifestObject.key)
    const material = manifest?.materials.find((candidate) => candidate.id === materialId) ?? null
    if (material) {
      return material
    }
  }

  return null
}

export async function upsertLocalMaterial(material: LocalSubjectDayMaterial) {
  const manifest = await readMaterialManifest(material.subject_id, material.week_number)
  const materials = manifest.materials.filter((candidate) => candidate.id !== material.id)
  materials.push(material)
  await saveMaterialManifest(material.subject_id, material.week_number, materials)
  return material
}

export async function deleteLocalMaterial(materialId: number) {
  const material = await findLocalMaterialById(materialId)
  if (!material) return null

  const manifest = await readMaterialManifest(material.subject_id, material.week_number)
  await saveMaterialManifest(
    material.subject_id,
    material.week_number,
    manifest.materials.filter((candidate) => candidate.id !== materialId)
  )

  return material
}

export async function readEntryManifest(subjectId: string, weekNumber: number) {
  const key = entryManifestKey(subjectId, weekNumber)
  const existing = await readJsonManifest<EntryManifest>(key)
  if (existing) {
    return {
      ...existing,
      entries: sortEntries(existing.entries ?? []),
    }
  }

  return {
    version: 1,
    subjectId,
    weekNumber,
    entries: [],
  } satisfies EntryManifest
}

export async function saveEntryManifest(subjectId: string, weekNumber: number, entries: LocalSubjectDayEntry[]) {
  const sortedEntries = sortEntries(entries)
  if (sortedEntries.length === 0) {
    await deleteR2Object(entryManifestKey(subjectId, weekNumber))
    return {
      version: 1,
      subjectId,
      weekNumber,
      entries: [],
    } satisfies EntryManifest
  }

  const manifest = {
    version: 1,
    subjectId,
    weekNumber,
    entries: sortedEntries,
  } satisfies EntryManifest
  await writeJsonManifest(entryManifestKey(subjectId, weekNumber), manifest)
  return manifest
}

export async function listLocalSubjectDayEntries(scope: {
  subjectId: string
  weekNumber?: number
  sessionDate?: string
  materialId?: number | null
}) {
  const weekNumbers =
    typeof scope.weekNumber === "number"
      ? [scope.weekNumber]
      : (
          await listR2ObjectsByPrefix(`${ENTRY_MANIFEST_PREFIX}${scope.subjectId}/`)
        ).map((object) => Number.parseInt(/week-(\d+)\.json$/.exec(object.key)?.[1] || "", 10)).filter(Number.isFinite)

  const entries: LocalSubjectDayEntry[] = []
  for (const weekNumber of weekNumbers) {
    const manifest = await readEntryManifest(scope.subjectId, weekNumber)
    entries.push(
      ...manifest.entries.filter((entry) => {
        if (scope.sessionDate && entry.session_date !== scope.sessionDate) return false
        if (scope.materialId != null && entry.subject_day_material_id !== scope.materialId) return false
        return true
      })
    )
  }

  return sortEntries(entries)
}

export async function findLocalEntryById(entryId: number) {
  const manifests = await listR2ObjectsByPrefix(ENTRY_MANIFEST_PREFIX)
  for (const manifestObject of manifests) {
    const manifest = await readJsonManifest<EntryManifest>(manifestObject.key)
    const entry = manifest?.entries.find((candidate) => candidate.id === entryId) ?? null
    if (entry) {
      return entry
    }
  }

  return null
}

export async function upsertLocalEntry(entry: LocalSubjectDayEntry) {
  const manifest = await readEntryManifest(entry.subject_id, entry.week_number)
  const entries = manifest.entries.filter((candidate) => candidate.id !== entry.id)
  entries.push(entry)
  await saveEntryManifest(entry.subject_id, entry.week_number, entries)
  return entry
}

export async function deleteLocalEntry(entryId: number) {
  const entry = await findLocalEntryById(entryId)
  if (!entry) return null

  const manifest = await readEntryManifest(entry.subject_id, entry.week_number)
  await saveEntryManifest(
    entry.subject_id,
    entry.week_number,
    manifest.entries.filter((candidate) => candidate.id !== entryId)
  )

  return entry
}

export async function readCronogramaManifest() {
  return readJsonManifest<CronogramaManifest>(CRONOGRAMA_MANIFEST_KEY)
}

export async function saveCronogramaManifest(payload: CronogramaManifest) {
  await writeJsonManifest(CRONOGRAMA_MANIFEST_KEY, payload)
  return payload
}

export async function deleteCronogramaManifest() {
  await deleteR2Object(CRONOGRAMA_MANIFEST_KEY)
}

export async function ensureLocalMaterialFromUpload(params: {
  subjectId: string
  sessionDate: string
  weekNumber: number
  weekdayIndex: number
  materialType: MaterialType
  containerId?: number | null
  driveFileId: string
  fileName: string
}) {
  const remoteFile = await getR2ObjectMetadata(params.driveFileId)
  const now = new Date().toISOString()
  const manifest = await readMaterialManifest(params.subjectId, params.weekNumber)
  const existing = manifest.materials.find((candidate) => candidate.drive_file_id === params.driveFileId)
  if (existing) return existing

  const siblingMaterials = manifest.materials.filter(
    (candidate) =>
      candidate.session_date === params.sessionDate &&
      candidate.material_type === params.materialType
  )
  const nextOrderIndex = siblingMaterials.length
  const material = {
    id: nextLocalId(),
    subject_id: params.subjectId,
    week_number: params.weekNumber,
    session_date: params.sessionDate,
    weekday_index: params.weekdayIndex,
    material_type: params.materialType,
    container_id: params.containerId ?? null,
    order_index: nextOrderIndex,
    file_name: normalizeUploadedPdfFileName(params.fileName) || remoteFile.name,
    drive_file_id: remoteFile.id,
    drive_mime_type: remoteFile.mimeType,
    drive_web_view_link: "",
    is_checkup_done: false,
    created_at: now,
    updated_at: now,
  } satisfies LocalSubjectDayMaterial

  await upsertLocalMaterial(material)
  return material
}
