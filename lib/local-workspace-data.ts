"use client"

import type {
  CronogramaRecord,
  DailySessionRecord,
  SocraticReviewGeneratedTurn,
  SocraticReviewSettings,
  SubjectDayEntry,
  SubjectDayEntryLink,
  SubjectDayMaterial,
  SubjectDayMaterialType,
  MaterialTagWorkspace,
  MaterialTagRegion,
  StudyTag,
  SubjectMaterialSynthesisRecord,
  SubjectMaterialContainer,
  SubjectShortcutKey,
  SubjectShortcuts,
} from "@/lib/study-types"
import {
  normalizeTagColor,
  normalizeTagDisplayName,
  normalizeTagName,
  wouldCreateTagCycle,
} from "@/lib/tag-utils"
import {
  ensureWorkspaceSubdirectories,
  getReadyWorkspaceHandle,
  loadWorkspaceHandle,
  queryWorkspacePermission,
  setReadyWorkspaceHandle,
} from "@/lib/local-workspace-client"
import { chooseNonOverwritingFileName } from "@/lib/local-subject-migration"
import {
  UNASSIGNED_WORKSPACE_TAB_ID,
  UNASSIGNED_WORKSPACE_TAB_NAME,
  allocateLocalSubjectStorageKey,
  createLocalSubjectDirectoryName,
  createEmptyLocalSubjectCatalog,
  findCatalogSubjectByAnyId,
  findCatalogSubjectByDirectoryName,
  findCatalogSubjectByName,
  getLegacyLocalSubjectSources,
  normalizeLocalSubjectCatalog,
  normalizeLocalSubjectName,
  type LegacyLocalSubjectCatalog,
  type LocalSubjectCatalog,
  type LocalSubjectCatalogEntry,
} from "@/lib/local-subject-catalog"
import { SUBJECTS } from "@/lib/subjects"
import { getWeekNumberForDate, getWeekdayIndexFromDateKey, parseDateKey } from "@/lib/subject-utils"

type MaterialManifest = {
  version: 1
  subjectId: string
  weekNumber: number
  materials: SubjectDayMaterial[]
}

type EntryManifest = {
  version: 1
  subjectId: string
  weekNumber: number
  entries: SubjectDayEntry[]
}

type TagManifest = {
  version: 1 | 2
  tags: StudyTag[]
  assignments: Record<string, number[]>
  regions: Record<string, MaterialTagRegion[]>
}

type SubjectCompletionRecord = {
  id: number
  date: string
  subject_id: string
  panorama: string
  created_at: string
  updated_at: string
}

type AudioPositionPayload = {
  entryId: number
  materialId: number
  pageNum: number
  xp: number
  yp: number
  transcriptText: string
  title: string
  audioUrl: string
  mimeType: string
  pairId: string | null
  pairRole: "question" | "answer" | null
}

type WorkspaceUploadSession = {
  uploadMode: "server"
  objectKey: string
  fileName: string
  driveFileId: string
  mimeType: string
  metadata?: Record<string, string>
}

type PersistedWorkspaceFile = {
  id: string
  name: string
  mimeType: string
}

export type LocalWorkspaceTabState = {
  id: string
  name: string
  color: string
  createdAt: string
  orderIndex?: number
  subjectIds: string[]
}

export type LocalCustomSubjectState = {
  id: string
  storageKey?: string
  name: string
  color: string
  tabId: string
  createdAt: string
  targetWeekday: number
}

export type LocalWorkspaceTabsState = {
  workspaceTabs: Record<string, LocalWorkspaceTabState>
  activeWorkspaceTabId: string
  customSubjects: Record<string, LocalCustomSubjectState>
  subjectWeekdays: Record<string, number>
  isMainWorkspaceTabVisible: boolean
}

export type LocalWorkspaceTabsReadResult = {
  state: LocalWorkspaceTabsState
  exists: boolean
}

const WORKSPACE_PROTOCOL = "workspace://"
const MANIFESTS_DIR = "manifests"
const MATERIALS_DIR = "materials"
const ENTRIES_DIR = "entries"
const CRONOGRAMA_DIR = "cronograma"
const THEORY_DIR = "teoria"
const PRACTICE_DIR = "practica"
const AUDIO_DIR = "audio"
const WORKSPACE_STATE_MANIFEST = [MANIFESTS_DIR, "workspace-state.json"]
const WORKSPACE_STATE_BACKUP_MANIFEST = [MANIFESTS_DIR, "workspace-state.backup.json"]
const WORKSPACE_STATE_PRE_RECONCILIATION_MANIFEST = [MANIFESTS_DIR, "workspace-state.pre-reconciliation.json"]
const SUBJECT_CATALOG_MANIFEST = [MANIFESTS_DIR, "subject-catalog.json"]
const TAGS_MANIFEST = [MANIFESTS_DIR, "tags.json"]
const MATERIAL_CONTAINERS_MANIFEST = [MANIFESTS_DIR, "material-containers.json"]
const MATERIAL_CONTAINERS_BACKUP_MANIFEST = [MANIFESTS_DIR, "material-containers.backup.json"]
const SUBJECT_MIGRATION_MANIFEST = [MANIFESTS_DIR, "subject-folder-migration-v2.json"]
const SUBJECT_CATALOG_V1_BACKUP_MANIFEST = [MANIFESTS_DIR, "subject-catalog.v1.backup.json"]
const MAIN_WORKSPACE_TAB_ID = "main"
const CURRENT_ALGEBRA_LEGACY_SOURCE_ID = "custom-1783994292371-hofqi6"

type SubjectFolderMigrationPlan = {
  subjectId: string
  name: string
  targetStorageKey: string
  sourceStorageKeys: string[]
}

type SubjectFolderMigrationJournal = {
  version: 2
  completedPlanSignatures: string[]
  plans: SubjectFolderMigrationPlan[]
  updatedAt: string
}

type LegacySubjectFolderMigrationJournal = {
  version: 1
  completedSubjectIds: string[]
  plans: SubjectFolderMigrationPlan[]
  updatedAt: string
}

function sanitizePathSegment(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._ -]+/g, "-")
    .replace(/-+/g, "-")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "archivo"
}

function normalizePdfFileName(fileName: string) {
  const trimmed = fileName.trim() || "archivo.pdf"
  return trimmed.toLowerCase().endsWith(".pdf") ? trimmed : `${trimmed}.pdf`
}

function normalizeAudioFileName(fileName: string, mimeType: string) {
  const trimmed = fileName.trim()
  if (trimmed) return trimmed
  if (mimeType.includes("mp4")) return "audio.mp4"
  if (mimeType.includes("mpeg")) return "audio.mp3"
  if (mimeType.includes("ogg")) return "audio.ogg"
  return "audio.webm"
}

function nextLocalId() {
  return Number(`${Date.now()}${Math.floor(Math.random() * 100).toString().padStart(2, "0")}`)
}

function nowIso() {
  return new Date().toISOString()
}

function logWorkspaceDataSource(_event: Record<string, unknown>) {}

function getDisplayTitle(entry: Pick<SubjectDayEntry, "custom_title" | "order_index">) {
  const customTitle = entry.custom_title?.trim()
  return customTitle && customTitle.length > 0 ? customTitle : `Duda ${entry.order_index + 1}`
}

function sortMaterials(materials: SubjectDayMaterial[]) {
  return [...materials].sort((left, right) => {
    if (left.session_date !== right.session_date) return left.session_date.localeCompare(right.session_date)
    if (left.material_type !== right.material_type) return left.material_type.localeCompare(right.material_type)
    if (left.order_index !== right.order_index) return left.order_index - right.order_index
    return left.id - right.id
  })
}

function sortEntries(entries: SubjectDayEntry[]) {
  return [...entries].sort((left, right) => {
    if (left.session_date !== right.session_date) return left.session_date.localeCompare(right.session_date)
    if (left.is_featured !== right.is_featured) return left.is_featured ? -1 : 1
    if (left.order_index !== right.order_index) return left.order_index - right.order_index
    return left.id - right.id
  })
}

function withEntryDefaults(entry: SubjectDayEntry): SubjectDayEntry {
  return {
    ...entry,
    display_title: getDisplayTitle(entry),
    external_links: Array.isArray(entry.external_links) ? entry.external_links : [],
  }
}

function materialManifestPath(subjectId: string, weekNumber: number) {
  return [MANIFESTS_DIR, MATERIALS_DIR, subjectId, `week-${weekNumber}.json`]
}

function entryManifestPath(subjectId: string, weekNumber: number) {
  return [MANIFESTS_DIR, ENTRIES_DIR, subjectId, `week-${weekNumber}.json`]
}

export function isWorkspaceFileId(value: string) {
  return value.startsWith(WORKSPACE_PROTOCOL)
}

function joinWorkspaceId(...segments: string[]) {
  const normalized = segments.filter(Boolean).join("/")
  return `${WORKSPACE_PROTOCOL}${normalized}`
}

function workspaceIdToSegments(workspaceId: string) {
  if (!isWorkspaceFileId(workspaceId)) {
    throw new Error("Invalid workspace file id.")
  }

  return workspaceId
    .slice(WORKSPACE_PROTOCOL.length)
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
}

async function ensureWorkspaceRootHandle() {
  const readyHandle = getReadyWorkspaceHandle()
  if (readyHandle) return readyHandle

  const handle = await loadWorkspaceHandle()
  if (!handle) {
    throw new Error("No hay una carpeta local seleccionada.")
  }

  const permission = await queryWorkspacePermission(handle, "readwrite")
  if (permission !== "granted") {
    throw new Error("No hay permiso de lectura/escritura para la carpeta local.")
  }

  await ensureWorkspaceSubdirectories(handle)
  setReadyWorkspaceHandle(handle)

  return handle
}

async function getDirectoryHandleBySegments(
  rootHandle: FileSystemDirectoryHandle,
  segments: string[],
  create = false
) {
  let current = rootHandle
  for (const segment of segments) {
    current = await current.getDirectoryHandle(segment, { create })
  }
  return current
}

async function getFileHandleBySegments(
  rootHandle: FileSystemDirectoryHandle,
  segments: string[],
  create = false
) {
  if (segments.length === 0) {
    throw new Error("Invalid file path.")
  }

  const directorySegments = segments.slice(0, -1)
  const fileName = segments[segments.length - 1]
  const directoryHandle = await getDirectoryHandleBySegments(rootHandle, directorySegments, create)
  return directoryHandle.getFileHandle(fileName, { create })
}

async function readJsonFile<T>(pathSegments: string[], fallback: T): Promise<T> {
  const rootHandle = await ensureWorkspaceRootHandle()

  try {
    const fileHandle = await getFileHandleBySegments(rootHandle, pathSegments, false)
    const file = await fileHandle.getFile()
    const text = await file.text()
    if (!text.trim()) return fallback
    return JSON.parse(text) as T
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") {
      return fallback
    }
    throw error
  }
}

const jsonWriteQueues = new Map<string, Promise<unknown>>()

async function writeJsonFile(pathSegments: string[], value: unknown) {
  const queueKey = pathSegments.join("/")
  const previous = jsonWriteQueues.get(queueKey) ?? Promise.resolve()
  const write = previous.catch(() => undefined).then(async () => {
    const rootHandle = await ensureWorkspaceRootHandle()
    const fileHandle = await getFileHandleBySegments(rootHandle, pathSegments, true)
    const writable = await fileHandle.createWritable()
    try {
      await writable.write(JSON.stringify(value, null, 2))
      await writable.close()
    } catch (error) {
      await writable.abort().catch(() => {})
      throw error
    }
  })
  jsonWriteQueues.set(queueKey, write)
  try {
    await write
  } finally {
    if (jsonWriteQueues.get(queueKey) === write) jsonWriteQueues.delete(queueKey)
  }
}

async function deleteJsonFile(pathSegments: string[]) {
  if (pathSegments.length === 0) return

  const rootHandle = await ensureWorkspaceRootHandle()
  const directorySegments = pathSegments.slice(0, -1)
  const fileName = pathSegments[pathSegments.length - 1]
  const directoryHandle = await getDirectoryHandleBySegments(rootHandle, directorySegments, false).catch(() => null)
  if (!directoryHandle) return
  await directoryHandle.removeEntry(fileName).catch(() => {})
}

async function jsonFileExists(pathSegments: string[]) {
  const rootHandle = await ensureWorkspaceRootHandle()
  const fileHandle = await getFileHandleBySegments(rootHandle, pathSegments, false).catch(() => null)
  return Boolean(fileHandle)
}

async function persistWorkspaceBlob(workspaceId: string, blob: Blob) {
  const rootHandle = await ensureWorkspaceRootHandle()
  const fileHandle = await getFileHandleBySegments(rootHandle, workspaceIdToSegments(workspaceId), true)
  const writable = await fileHandle.createWritable()
  await writable.write(blob)
  await writable.close()
}

async function deleteWorkspaceBlob(workspaceId: string) {
  const rootHandle = await ensureWorkspaceRootHandle()
  const segments = workspaceIdToSegments(workspaceId)
  const fileName = segments[segments.length - 1]
  const directoryHandle = await getDirectoryHandleBySegments(rootHandle, segments.slice(0, -1), false)
  await directoryHandle.removeEntry(fileName).catch(() => {})
}

export async function getWorkspaceFile(workspaceId: string) {
  const rootHandle = await ensureWorkspaceRootHandle()
  const fileHandle = await getFileHandleBySegments(rootHandle, workspaceIdToSegments(workspaceId), false)
  return fileHandle.getFile()
}

export async function createObjectUrlForWorkspaceFile(workspaceId: string) {
  const file = await getWorkspaceFile(workspaceId)
  return URL.createObjectURL(file)
}

export async function getPersistedWorkspaceFile(workspaceId: string): Promise<PersistedWorkspaceFile> {
  const file = await getWorkspaceFile(workspaceId)
  return {
    id: workspaceId,
    name: file.name,
    mimeType: file.type || "application/octet-stream",
  }
}

async function readSessionsManifest() {
  return readJsonFile<Record<string, DailySessionRecord>>([MANIFESTS_DIR, "sessions.json"], {})
}

async function writeSessionsManifest(value: Record<string, DailySessionRecord>) {
  await writeJsonFile([MANIFESTS_DIR, "sessions.json"], value)
}

async function readSubjectCompletionsManifest() {
  return readJsonFile<Record<string, SubjectCompletionRecord>>([MANIFESTS_DIR, "subject-completions.json"], {})
}

async function writeSubjectCompletionsManifest(value: Record<string, SubjectCompletionRecord>) {
  await writeJsonFile([MANIFESTS_DIR, "subject-completions.json"], value)
}

async function readShortcutsManifest() {
  return readJsonFile<Record<string, SubjectShortcuts>>([MANIFESTS_DIR, "subject-shortcuts.json"], {})
}

async function writeShortcutsManifest(value: Record<string, SubjectShortcuts>) {
  await writeJsonFile([MANIFESTS_DIR, "subject-shortcuts.json"], value)
}

async function readAiPromptValue() {
  const payload = await readJsonFile<{ prompt: string }>([MANIFESTS_DIR, "ai-prompt.json"], { prompt: "" })
  return typeof payload.prompt === "string" ? payload.prompt : ""
}

async function writeAiPromptValue(prompt: string) {
  await writeJsonFile([MANIFESTS_DIR, "ai-prompt.json"], { prompt })
}

function createEmptyWorkspaceTabsState(): LocalWorkspaceTabsState {
  return {
    workspaceTabs: {},
    activeWorkspaceTabId: MAIN_WORKSPACE_TAB_ID,
    customSubjects: {},
    subjectWeekdays: {},
    isMainWorkspaceTabVisible: true,
  }
}

function normalizeWorkspaceTab(input: Partial<LocalWorkspaceTabState> | null | undefined) {
  if (
    !input ||
    typeof input.id !== "string" ||
    typeof input.name !== "string" ||
    typeof input.color !== "string" ||
    typeof input.createdAt !== "string" ||
    !Array.isArray(input.subjectIds)
  ) {
    return null
  }

  const normalized: LocalWorkspaceTabState = {
    id: input.id,
    name: input.name,
    color: input.color,
    createdAt: input.createdAt,
    subjectIds: input.subjectIds.filter((subjectId): subjectId is string => typeof subjectId === "string"),
  }

  if (typeof input.orderIndex === "number" && Number.isFinite(input.orderIndex)) {
    normalized.orderIndex = input.orderIndex
  }

  return normalized
}

function normalizeWorkspaceTabs(input: Partial<LocalWorkspaceTabsState>["workspaceTabs"]) {
  if (!input || typeof input !== "object") return {}

  return Object.entries(input).reduce<Record<string, LocalWorkspaceTabState>>((accumulator, [tabId, tab]) => {
    const normalizedTab = normalizeWorkspaceTab(tab)
    if (normalizedTab && normalizedTab.id !== MAIN_WORKSPACE_TAB_ID) {
      accumulator[tabId] = normalizedTab
    }
    return accumulator
  }, {})
}

function normalizeLocalCustomSubject(input: Partial<LocalCustomSubjectState> | null | undefined) {
  if (
    !input ||
    typeof input.id !== "string" ||
    typeof input.name !== "string" ||
    typeof input.color !== "string" ||
    typeof input.tabId !== "string" ||
    typeof input.createdAt !== "string"
  ) {
    return null
  }

  const parsedWeekday = Number(input.targetWeekday)
  const targetWeekday = Number.isInteger(parsedWeekday) && parsedWeekday >= 0 && parsedWeekday <= 6 ? parsedWeekday : 0

  return {
    id: input.id,
    storageKey: typeof input.storageKey === "string" && input.storageKey.trim() ? input.storageKey.trim() : input.id,
    name: input.name,
    color: input.color,
    tabId: input.tabId,
    createdAt: input.createdAt,
    targetWeekday,
  }
}

function normalizeLocalCustomSubjects(input: Partial<LocalWorkspaceTabsState>["customSubjects"]) {
  if (!input || typeof input !== "object") return {}

  return Object.entries(input).reduce<Record<string, LocalCustomSubjectState>>((accumulator, [subjectId, subject]) => {
    const normalizedSubject = normalizeLocalCustomSubject(subject)
    if (normalizedSubject) {
      accumulator[subjectId] = normalizedSubject
    }
    return accumulator
  }, {})
}

function normalizeLocalWorkspaceTabsState(input: Partial<LocalWorkspaceTabsState> | null | undefined): LocalWorkspaceTabsState {
  const workspaceTabs = normalizeWorkspaceTabs(input?.workspaceTabs)
  const customSubjects = normalizeLocalCustomSubjects(input?.customSubjects)
  const subjectWeekdays = Object.entries(input?.subjectWeekdays ?? {}).reduce<Record<string, number>>((accumulator, [subjectId, value]) => {
    const weekday = Number(value)
    if (subjectId.trim() && Number.isInteger(weekday) && weekday >= 0 && weekday <= 6) accumulator[subjectId] = weekday
    return accumulator
  }, {})
  for (const subject of Object.values(customSubjects)) {
    if (!(subject.id in subjectWeekdays)) subjectWeekdays[subject.id] = subject.targetWeekday
  }
  const isMainWorkspaceTabVisible = input?.isMainWorkspaceTabVisible !== false
  const activeCandidate =
    typeof input?.activeWorkspaceTabId === "string" && input.activeWorkspaceTabId.trim()
      ? input.activeWorkspaceTabId.trim()
      : MAIN_WORKSPACE_TAB_ID
  const firstWorkspaceTabId =
    Object.values(workspaceTabs).sort((left, right) => {
      const leftOrder = typeof left.orderIndex === "number" ? left.orderIndex : Number.POSITIVE_INFINITY
      const rightOrder = typeof right.orderIndex === "number" ? right.orderIndex : Number.POSITIVE_INFINITY
      if (leftOrder !== rightOrder) return leftOrder - rightOrder
      return left.createdAt.localeCompare(right.createdAt)
    })[0]?.id ?? null
  const hasActiveCandidate =
    activeCandidate === MAIN_WORKSPACE_TAB_ID ? isMainWorkspaceTabVisible : Boolean(workspaceTabs[activeCandidate])

  return {
    workspaceTabs,
    activeWorkspaceTabId: hasActiveCandidate
      ? activeCandidate
      : isMainWorkspaceTabVisible
        ? MAIN_WORKSPACE_TAB_ID
        : firstWorkspaceTabId ?? MAIN_WORKSPACE_TAB_ID,
    customSubjects,
    subjectWeekdays,
    isMainWorkspaceTabVisible,
  }
}

async function workspaceFileExists(workspaceId: string) {
  if (!isWorkspaceFileId(workspaceId)) return false
  const rootHandle = await ensureWorkspaceRootHandle()
  return Boolean(await getFileHandleBySegments(rootHandle, workspaceIdToSegments(workspaceId), false).catch(() => null))
}

async function removeDirectoryBySegments(pathSegments: string[]) {
  if (pathSegments.length === 0) return
  const rootHandle = await ensureWorkspaceRootHandle()
  const parent = await getDirectoryHandleBySegments(rootHandle, pathSegments.slice(0, -1), false).catch(() => null)
  if (!parent) return
  try {
    await parent.removeEntry(pathSegments[pathSegments.length - 1], { recursive: true })
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return
    throw error
  }
}

async function countFilesBySegments(pathSegments: string[]) {
  const rootHandle = await ensureWorkspaceRootHandle()
  const directory = await getDirectoryHandleBySegments(rootHandle, pathSegments, false).catch(() => null)
  if (!directory) return 0
  let count = 0
  for await (const [, handle] of directory.entries()) {
    if (handle.kind === "file") count += 1
    else count += await countFilesInDirectory(handle as FileSystemDirectoryHandle)
  }
  return count
}

async function directoryExistsBySegments(pathSegments: string[]) {
  const rootHandle = await ensureWorkspaceRootHandle()
  return Boolean(await getDirectoryHandleBySegments(rootHandle, pathSegments, false).catch(() => null))
}

async function countFilesInDirectory(directory: FileSystemDirectoryHandle): Promise<number> {
  let count = 0
  for await (const [, handle] of directory.entries()) {
    if (handle.kind === "file") count += 1
    else count += await countFilesInDirectory(handle as FileSystemDirectoryHandle)
  }
  return count
}

async function listLocalDirectoryNames(pathSegments: string[]) {
  const rootHandle = await ensureWorkspaceRootHandle()
  const directory = await getDirectoryHandleBySegments(rootHandle, pathSegments, false).catch(() => null)
  if (!directory) return [] as string[]
  const names: string[] = []
  for await (const [name, handle] of directory.entries()) {
    if (handle.kind === "directory") names.push(name)
  }
  return names
}

async function filesHaveSameContent(left: File, right: File) {
  if (left.size !== right.size) return false
  const [leftBytes, rightBytes] = await Promise.all([left.arrayBuffer(), right.arrayBuffer()])
  const leftView = new Uint8Array(leftBytes)
  const rightView = new Uint8Array(rightBytes)
  for (let index = 0; index < leftView.length; index += 1) {
    if (leftView[index] !== rightView[index]) return false
  }
  return true
}

async function chooseCopiedFileName(
  targetDirectory: FileSystemDirectoryHandle,
  requestedName: string,
  sourceFile: File
) {
  return chooseNonOverwritingFileName({
    requestedName,
    source: sourceFile,
    readExisting: async (candidate) => {
      const handle = await targetDirectory.getFileHandle(candidate, { create: false }).catch(() => null)
      return handle ? handle.getFile() : null
    },
    hasSameContent: filesHaveSameContent,
  })
}

async function copyDirectoryContents(
  rootHandle: FileSystemDirectoryHandle,
  sourceSegments: string[],
  targetSegments: string[],
  pathRewrites: Map<string, string>
) {
  const sourceDirectory = await getDirectoryHandleBySegments(rootHandle, sourceSegments, false).catch(() => null)
  if (!sourceDirectory) return false
  const targetDirectory = await getDirectoryHandleBySegments(rootHandle, targetSegments, true)
  for await (const [name, handle] of sourceDirectory.entries()) {
    if (handle.kind === "directory") {
      await copyDirectoryContents(
        rootHandle,
        [...sourceSegments, name],
        [...targetSegments, name],
        pathRewrites
      )
      continue
    }

    const sourceFile = await (handle as FileSystemFileHandle).getFile()
    const target = await chooseCopiedFileName(targetDirectory, name, sourceFile)
    if (!target.alreadyCopied) {
      const targetHandle = await targetDirectory.getFileHandle(target.name, { create: true })
      const writable = await targetHandle.createWritable()
      try {
        await writable.write(sourceFile)
        await writable.close()
      } catch (error) {
        await writable.abort().catch(() => {})
        throw error
      }
      const copiedFile = await targetHandle.getFile()
      if (!(await filesHaveSameContent(sourceFile, copiedFile))) {
        throw new Error(`No se pudo verificar la copia de ${sourceSegments.join("/")}/${name}.`)
      }
    }
    pathRewrites.set(
      joinWorkspaceId(...sourceSegments, name),
      joinWorkspaceId(...targetSegments, target.name)
    )
  }
  return true
}

function rewriteWorkspaceId(
  workspaceId: string,
  pathRewrites: Map<string, string>,
  sourceStorageKeys: string[],
  targetStorageKey: string
) {
  const exact = pathRewrites.get(workspaceId)
  if (exact) return exact
  if (!isWorkspaceFileId(workspaceId)) return workspaceId
  const segments = workspaceIdToSegments(workspaceId)
  if (
    segments.length >= 2 &&
    [THEORY_DIR, PRACTICE_DIR, AUDIO_DIR].includes(segments[0] as typeof THEORY_DIR) &&
    sourceStorageKeys.includes(segments[1])
  ) {
    segments[1] = targetStorageKey
    return joinWorkspaceId(...segments)
  }
  return workspaceId
}

async function readLocalSubjectCatalogWithLegacy() {
  const raw = await readJsonFile<LegacyLocalSubjectCatalog | null>(SUBJECT_CATALOG_MANIFEST, null)
  return {
    raw,
    catalog: raw ? normalizeLocalSubjectCatalog(raw) : createEmptyLocalSubjectCatalog(),
    legacySources: getLegacyLocalSubjectSources(raw),
  }
}

async function readLocalSubjectCatalog() {
  return (await readLocalSubjectCatalogWithLegacy()).catalog
}

async function writeLocalSubjectCatalog(catalog: LocalSubjectCatalog) {
  await writeJsonFile(SUBJECT_CATALOG_MANIFEST, normalizeLocalSubjectCatalog(catalog))
}

async function ensureLocalSubjectDirectories(subjects: LocalSubjectCatalogEntry[]) {
  const rootHandle = await ensureWorkspaceRootHandle()
  for (const subject of subjects) {
    for (const baseDir of [THEORY_DIR, PRACTICE_DIR, AUDIO_DIR]) {
      await getDirectoryHandleBySegments(rootHandle, [baseDir, subject.storageKey], true)
    }
  }
}

function allocateUniqueNumericId(used: Set<number>) {
  let id = nextLocalId()
  while (used.has(id)) id = nextLocalId()
  used.add(id)
  return id
}

async function migrateSubjectPlan(plan: SubjectFolderMigrationPlan) {
  const rootHandle = await ensureWorkspaceRootHandle()
  const sources = Array.from(new Set(plan.sourceStorageKeys.filter((source) => source && source !== plan.targetStorageKey)))
  const allSources = Array.from(new Set([plan.targetStorageKey, ...sources]))
  const pathRewrites = new Map<string, string>()

  for (const source of sources) {
    for (const baseDir of [THEORY_DIR, PRACTICE_DIR, AUDIO_DIR]) {
      await copyDirectoryContents(
        rootHandle,
        [baseDir, source],
        [baseDir, plan.targetStorageKey],
        pathRewrites
      )
    }
  }

  const containersManifest = await readMaterialContainersManifest()
  const canonicalDefaults = buildDefaultLocalSubjectContainers(plan.targetStorageKey)
  const canonicalStored = containersManifest[plan.targetStorageKey] ?? []
  const canonicalCustom = canonicalStored.filter((container) => container.kind === "custom")
  const mergedContainers: SubjectMaterialContainer[] = [...canonicalDefaults, ...canonicalCustom.map((container) => ({
    ...container,
    subjectId: plan.targetStorageKey,
  }))]
  const usedContainerIds = new Set(mergedContainers.map((container) => container.id))
  const containerIdMap = new Map<string, number>()
  for (const source of allSources) {
    const sourceContainers = containersManifest[source] ?? []
    for (const container of sourceContainers) {
      const defaultTarget = container.kind === "theory" || container.kind === "practice"
        ? mergedContainers.find((candidate) => candidate.kind === container.kind)
        : mergedContainers.find((candidate) =>
            candidate.kind === "custom" && candidate.normalizedName === container.normalizedName
          )
      if (defaultTarget) {
        containerIdMap.set(`${source}:${container.id}`, defaultTarget.id)
        continue
      }
      const id = usedContainerIds.has(container.id) ? allocateUniqueNumericId(usedContainerIds) : container.id
      usedContainerIds.add(id)
      const migrated = { ...container, id, subjectId: plan.targetStorageKey }
      mergedContainers.push(migrated)
      containerIdMap.set(`${source}:${container.id}`, id)
    }
  }
  containersManifest[plan.targetStorageKey] = mergedContainers
  for (const source of sources) delete containersManifest[source]

  const materialWeeks = Array.from(new Set((await Promise.all(
    allSources.map((source) => listWeekNumbersForManifestKind(MATERIALS_DIR, source))
  )).flat())).sort((left, right) => left - right)
  const materialIdMap = new Map<string, number>()
  const usedMaterialIds = new Set<number>()
  const migratedMaterialsByWeek = new Map<number, SubjectDayMaterial[]>()

  for (const weekNumber of materialWeeks) {
    const migrated: SubjectDayMaterial[] = []
    const byPath = new Map<string, SubjectDayMaterial>()
    for (const source of allSources) {
      const manifest = await readMaterialManifest(source, weekNumber)
      for (const material of manifest.materials) {
        const driveFileId = rewriteWorkspaceId(material.drive_file_id, pathRewrites, allSources, plan.targetStorageKey)
        const existingByPath = driveFileId ? byPath.get(driveFileId) : null
        if (existingByPath) {
          materialIdMap.set(`${source}:${material.id}`, existingByPath.id)
          continue
        }
        const id = usedMaterialIds.has(material.id) ? allocateUniqueNumericId(usedMaterialIds) : material.id
        usedMaterialIds.add(id)
        materialIdMap.set(`${source}:${material.id}`, id)
        const migratedMaterial: SubjectDayMaterial = {
          ...material,
          id,
          subject_id: plan.targetStorageKey,
          container_id: material.container_id == null
            ? null
            : containerIdMap.get(`${source}:${material.container_id}`) ??
              mergedContainers.find((container) => container.kind === material.material_type)?.id ?? null,
          drive_file_id: driveFileId,
          local_file_status: material.local_file_status === "recovered" ? "available" : material.local_file_status,
        }
        migrated.push(migratedMaterial)
        if (driveFileId) byPath.set(driveFileId, migratedMaterial)
      }
    }
    migratedMaterialsByWeek.set(weekNumber, migrated)
  }

  const entryWeeks = Array.from(new Set((await Promise.all(
    allSources.map((source) => listWeekNumbersForManifestKind(ENTRIES_DIR, source))
  )).flat())).sort((left, right) => left - right)
  const usedEntryIds = new Set<number>()
  const migratedEntriesByWeek = new Map<number, SubjectDayEntry[]>()
  for (const weekNumber of entryWeeks) {
    const migrated: SubjectDayEntry[] = []
    for (const source of allSources) {
      const manifest = await readEntryManifest(source, weekNumber)
      for (const entry of manifest.entries) {
        const id = usedEntryIds.has(entry.id) ? allocateUniqueNumericId(usedEntryIds) : entry.id
        usedEntryIds.add(id)
        migrated.push({
          ...entry,
          id,
          subject_id: plan.targetStorageKey,
          subject_day_material_id: entry.subject_day_material_id == null
            ? null
            : materialIdMap.get(`${source}:${entry.subject_day_material_id}`) ?? entry.subject_day_material_id,
          drive_file_id: rewriteWorkspaceId(entry.drive_file_id, pathRewrites, allSources, plan.targetStorageKey),
        })
      }
    }
    migratedEntriesByWeek.set(weekNumber, migrated)
  }

  const synthesisWeeks = Array.from(new Set((await Promise.all(
    allSources.map((source) => listSynthesisWeekNumbersForSubject(source))
  )).flat())).sort((left, right) => left - right)
  const synthesisByWeek = new Map<number, SubjectMaterialSynthesisRecord[]>()
  for (const weekNumber of synthesisWeeks) {
    const byMaterialId = new Map<number, SubjectMaterialSynthesisRecord>()
    for (const source of allSources) {
      for (const item of await readSynthesisProgressManifest(source, weekNumber)) {
        const materialId = materialIdMap.get(`${source}:${item.subjectDayMaterialId}`) ?? item.subjectDayMaterialId
        const current = byMaterialId.get(materialId)
        if (!current || String(item.updatedAt ?? "") >= String(current.updatedAt ?? "")) {
          byMaterialId.set(materialId, { ...item, subjectDayMaterialId: materialId })
        }
      }
    }
    synthesisByWeek.set(weekNumber, Array.from(byMaterialId.values()))
  }

  const [tags, shortcuts, sessions, completions] = await Promise.all([
    readTagManifest(),
    readShortcutsManifest(),
    readSessionsManifest(),
    readSubjectCompletionsManifest(),
  ])
  for (const [mappingKey, targetId] of materialIdMap) {
    const sourceId = Number(mappingKey.slice(mappingKey.lastIndexOf(":") + 1))
    if (sourceId === targetId) continue
    const sourceKey = String(sourceId)
    const targetKey = String(targetId)
    tags.assignments[targetKey] = Array.from(new Set([
      ...(tags.assignments[targetKey] ?? []),
      ...(tags.assignments[sourceKey] ?? []),
    ]))
    delete tags.assignments[sourceKey]
    for (const [regionKey, regions] of Object.entries({ ...tags.regions })) {
      if (!regionKey.startsWith(`${sourceId}:`)) continue
      const targetRegionKey = `${targetId}:${regionKey.slice(regionKey.indexOf(":") + 1)}`
      tags.regions[targetRegionKey] = [
        ...(tags.regions[targetRegionKey] ?? []),
        ...regions.map((region) => ({ ...region, materialId: targetId })),
      ]
      delete tags.regions[regionKey]
    }
  }

  const shortcutRecords = allSources.map((source) => shortcuts[source]).filter(Boolean)
  if (shortcutRecords.length > 0) {
    shortcuts[plan.targetStorageKey] = shortcutRecords.reduce<SubjectShortcuts>((merged, record) => ({
      subjectId: plan.targetStorageKey,
      eFich: merged.eFich ?? record.eFich,
      figma: merged.figma ?? record.figma,
      nlm: merged.nlm ?? record.nlm,
    }), { subjectId: plan.targetStorageKey, eFich: null, figma: null, nlm: null })
  }
  for (const source of sources) delete shortcuts[source]

  const sourceSet = new Set(allSources)
  for (const session of Object.values(sessions)) {
    session.active_subject_ids = Array.from(new Set(session.active_subject_ids.map((id) => sourceSet.has(id) ? plan.subjectId : id)))
    session.completed_subjects = Object.fromEntries(Object.entries(session.completed_subjects).map(([id, value]) => [
      sourceSet.has(id) ? plan.subjectId : id,
      value,
  ]))
}
  for (const [key, completion] of Object.entries({ ...completions })) {
    if (!sourceSet.has(completion.subject_id)) continue
    const targetKey = `${completion.date}:${plan.subjectId}`
    completions[targetKey] = { ...completion, subject_id: plan.subjectId }
    if (key !== targetKey) delete completions[key]
  }

  await Promise.all([
    ...Array.from(migratedMaterialsByWeek, ([week, materials]) => writeMaterialManifest(plan.targetStorageKey, week, materials)),
    ...Array.from(migratedEntriesByWeek, ([week, entries]) => writeEntryManifest(plan.targetStorageKey, week, entries)),
    ...Array.from(synthesisByWeek, ([week, items]) => writeSynthesisProgressManifest(plan.targetStorageKey, week, items)),
    writeMaterialContainersManifest(containersManifest),
    writeTagManifest(tags),
    writeShortcutsManifest(shortcuts),
    writeSessionsManifest(sessions),
    writeSubjectCompletionsManifest(completions),
  ])

  for (const source of sources) {
    await Promise.all([
      removeDirectoryBySegments([THEORY_DIR, source]),
      removeDirectoryBySegments([PRACTICE_DIR, source]),
      removeDirectoryBySegments([AUDIO_DIR, source]),
      removeDirectoryBySegments([MANIFESTS_DIR, MATERIALS_DIR, source]),
      removeDirectoryBySegments([MANIFESTS_DIR, ENTRIES_DIR, source]),
      removeDirectoryBySegments([MANIFESTS_DIR, "synthesis", source]),
    ])
  }
  await ensureLocalSubjectDirectories([{
    id: plan.subjectId,
    name: plan.name,
    normalizedName: normalizeLocalSubjectName(plan.name),
    storageKey: plan.targetStorageKey,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }])
}

async function runSubjectFolderMigrations(plans: SubjectFolderMigrationPlan[]) {
  if (plans.length === 0) return
  const existingJournal = await readJsonFile<SubjectFolderMigrationJournal | LegacySubjectFolderMigrationJournal | null>(
    SUBJECT_MIGRATION_MANIFEST,
    null
  )
  const planSignature = (plan: SubjectFolderMigrationPlan) => JSON.stringify([
    plan.subjectId,
    plan.targetStorageKey,
    [...plan.sourceStorageKeys].sort(),
  ])
  const completedPlanSignatures = existingJournal?.version === 2
    ? existingJournal.completedPlanSignatures
    : plans
        .filter((plan) => existingJournal?.completedSubjectIds.includes(plan.subjectId))
        .map(planSignature)
  const journal: SubjectFolderMigrationJournal = {
    version: 2,
    completedPlanSignatures: Array.from(new Set(completedPlanSignatures)),
    plans,
    updatedAt: nowIso(),
  }
  await writeJsonFile(SUBJECT_MIGRATION_MANIFEST, journal)
  for (const plan of plans) {
    const signature = planSignature(plan)
    if (journal.completedPlanSignatures.includes(signature)) continue
    await migrateSubjectPlan(plan)
    journal.completedPlanSignatures.push(signature)
    journal.updatedAt = nowIso()
    await writeJsonFile(SUBJECT_MIGRATION_MANIFEST, journal)
  }
}

async function discoverLocalSubjectSourceIds(state: LocalWorkspaceTabsState, catalog: LocalSubjectCatalog) {
  const [materialIds, entryIds, synthesisIds, theoryIds, practiceIds, audioIds, containerManifest] = await Promise.all([
    listLocalDirectoryNames([MANIFESTS_DIR, MATERIALS_DIR]),
    listLocalDirectoryNames([MANIFESTS_DIR, ENTRIES_DIR]),
    listLocalDirectoryNames([MANIFESTS_DIR, "synthesis"]),
    listLocalDirectoryNames([THEORY_DIR]),
    listLocalDirectoryNames([PRACTICE_DIR]),
    listLocalDirectoryNames([AUDIO_DIR]),
    readJsonFile<Record<string, SubjectMaterialContainer[]>>(MATERIAL_CONTAINERS_MANIFEST, {}),
  ])
  return Array.from(new Set([
    ...Object.keys(containerManifest),
    ...materialIds,
    ...entryIds,
    ...synthesisIds,
    ...theoryIds,
    ...practiceIds,
    ...audioIds,
  ].filter(Boolean)))
}

function stableLocalMaterialId(workspaceId: string) {
  let left = 2166136261
  let right = 5381
  for (let index = 0; index < workspaceId.length; index += 1) {
    const code = workspaceId.charCodeAt(index)
    left = Math.imul(left ^ code, 16777619)
    right = Math.imul(right * 33, 1) ^ code
  }
  return 1_000_000_000_000 + (left >>> 0) * 1_000_000 + ((right >>> 0) % 1_000_000)
}

async function reconstructLocalMaterialManifests() {
  const rootHandle = await ensureWorkspaceRootHandle()
  const recoveredScopes: Array<{ subjectId: string; weekNumber: number; sessionDate: string }> = []
  for (const [baseDir, materialType] of [[THEORY_DIR, "theory"], [PRACTICE_DIR, "practice"]] as const) {
    const baseHandle = await getDirectoryHandleBySegments(rootHandle, [baseDir], false).catch(() => null)
    if (!baseHandle) continue
    for await (const [subjectId, subjectHandle] of baseHandle.entries()) {
      if (subjectHandle.kind !== "directory") continue
      for await (const [weekName, weekHandle] of (subjectHandle as FileSystemDirectoryHandle).entries()) {
        if (weekHandle.kind !== "directory") continue
        const weekMatch = /^week-(\d+)$/i.exec(weekName)
        if (!weekMatch) continue
        const weekNumber = Number.parseInt(weekMatch[1], 10)
        const manifest = await readMaterialManifest(subjectId, weekNumber)
        const additions: SubjectDayMaterial[] = []
        for await (const [sessionDate, dateHandle] of (weekHandle as FileSystemDirectoryHandle).entries()) {
          if (dateHandle.kind !== "directory" || !/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) continue
          for await (const [storedFileName, fileHandle] of (dateHandle as FileSystemDirectoryHandle).entries()) {
            if (fileHandle.kind !== "file" || !storedFileName.toLowerCase().endsWith(".pdf")) continue
            const workspaceId = joinWorkspaceId(baseDir, subjectId, weekName, sessionDate, storedFileName)
            if (manifest.materials.some((material) => material.drive_file_id === workspaceId)) continue
            const file = await (fileHandle as FileSystemFileHandle).getFile()
            const timestamp = file.lastModified ? new Date(file.lastModified).toISOString() : nowIso()
            const fileName = storedFileName.replace(/^\d{10,17}-/, "") || storedFileName
            const siblings = [...manifest.materials, ...additions].filter(
              (material) => material.session_date === sessionDate && material.material_type === materialType
            )
            additions.push({
              id: stableLocalMaterialId(workspaceId),
              subject_id: subjectId,
              week_number: weekNumber,
              session_date: sessionDate,
              weekday_index: getWeekdayIndexFromDateKey(sessionDate),
              material_type: materialType,
              container_id: null,
              order_index: siblings.length,
              file_name: fileName,
              drive_file_id: workspaceId,
              drive_mime_type: file.type || "application/pdf",
              drive_web_view_link: "",
              is_checkup_done: false,
              local_file_status: "available",
              created_at: timestamp,
              updated_at: timestamp,
            })
          }
        }
        if (additions.length > 0) {
          const latestManifest = await readMaterialManifest(subjectId, weekNumber)
          const knownWorkspaceIds = new Set(latestManifest.materials.map((material) => material.drive_file_id))
          const newAdditions = additions.filter((material) => !knownWorkspaceIds.has(material.drive_file_id))
          if (newAdditions.length > 0) {
            await writeMaterialManifest(subjectId, weekNumber, [...latestManifest.materials, ...newAdditions])
            recoveredScopes.push(
              ...newAdditions.map((material) => ({
                subjectId,
                weekNumber,
                sessionDate: material.session_date,
              }))
            )
          }
        }
      }
    }
  }
  return recoveredScopes
}

function replaceWorkspaceSubjectId(
  state: LocalWorkspaceTabsState,
  sourceId: string,
  targetId: string,
  targetStorageKey?: string
) {
  if (sourceId === targetId) return state
  const workspaceTabs = Object.fromEntries(
    Object.entries(state.workspaceTabs).map(([tabId, tab]) => [
      tabId,
      {
        ...tab,
        subjectIds: Array.from(new Set(tab.subjectIds.map((id) => id === sourceId ? targetId : id))),
      },
    ])
  )
  const customSubjects = { ...state.customSubjects }
  const source = customSubjects[sourceId]
  if (source && !customSubjects[targetId]) {
    customSubjects[targetId] = { ...source, id: targetId, storageKey: targetStorageKey ?? source.storageKey }
  }
  delete customSubjects[sourceId]
  return { ...state, workspaceTabs, customSubjects }
}

function removeLegacyRecoveredWorkspaceTab(state: LocalWorkspaceTabsState) {
  const workspaceTabs = { ...state.workspaceTabs }
  delete workspaceTabs["tab-recovered"]
  return { ...state, workspaceTabs }
}

function buildSubjectFolderMigrationPlans(
  inputState: LocalWorkspaceTabsState,
  catalog: LocalSubjectCatalog,
  legacySources: Record<string, string[]>
) {
  const plans = new Map<string, SubjectFolderMigrationPlan>()
  for (const subject of Object.values(inputState.customSubjects)) {
    const safeName = createLocalSubjectDirectoryName(subject.name)
    const catalogEntry = findCatalogSubjectByAnyId(catalog, subject.id) ?? findCatalogSubjectByName(catalog, safeName)
    const subjectId = catalogEntry?.id ?? subject.id
    const sources = new Set([
      subject.id,
      subject.storageKey ?? subject.id,
      catalogEntry?.storageKey ?? "",
      ...(legacySources[subject.id] ?? []),
      ...(catalogEntry ? legacySources[catalogEntry.id] ?? [] : []),
    ].filter(Boolean))
    if (normalizeLocalSubjectName(safeName) === normalizeLocalSubjectName("Algebra 2")) {
      sources.add("algebra")
      sources.add(CURRENT_ALGEBRA_LEGACY_SOURCE_ID)
    }
    plans.set(subjectId, {
      subjectId,
      name: safeName,
      targetStorageKey: safeName,
      sourceStorageKeys: Array.from(sources),
    })
  }
  return Array.from(plans.values())
}

function reconcileLocalSubjectCatalogState(
  inputState: LocalWorkspaceTabsState,
  inputCatalog: LocalSubjectCatalog,
  discoveredSourceIds: string[]
) {
  let state = removeLegacyRecoveredWorkspaceTab(normalizeLocalWorkspaceTabsState(inputState))
  let catalog = normalizeLocalSubjectCatalog(inputCatalog)
  const timestamp = new Date().toISOString()

  for (const subject of Object.values(state.customSubjects)) {
    const safeName = createLocalSubjectDirectoryName(subject.name)
    const existing = findCatalogSubjectByAnyId(catalog, subject.id) ?? findCatalogSubjectByName(catalog, safeName)
    if (existing && existing.id !== subject.id) {
      state = replaceWorkspaceSubjectId(state, subject.id, existing.id, existing.storageKey)
    }
    const entry: LocalSubjectCatalogEntry = {
      id: existing?.id ?? subject.id,
      name: safeName,
      normalizedName: normalizeLocalSubjectName(safeName),
      storageKey: safeName,
      createdAt: existing?.createdAt ?? subject.createdAt,
      updatedAt: existing?.name === safeName && existing.storageKey === safeName ? existing.updatedAt : timestamp,
    }
    catalog.subjects[entry.id] = entry
  }

  for (const sourceId of discoveredSourceIds) {
    const matchingSubject = findCatalogSubjectByDirectoryName(catalog, sourceId)
    if (matchingSubject) {
      if (!state.customSubjects[matchingSubject.id]) {
        state.customSubjects[matchingSubject.id] = {
          id: matchingSubject.id,
          storageKey: matchingSubject.storageKey,
          name: matchingSubject.name,
          color: "#0f766e",
          tabId: UNASSIGNED_WORKSPACE_TAB_ID,
          createdAt: matchingSubject.createdAt,
          targetWeekday: 0,
        }
      }
      continue
    }
    const name = createLocalSubjectDirectoryName(sourceId)
    const id = allocateLocalSubjectStorageKey(catalog, name)
    catalog.subjects[id] = {
      id,
      name,
      normalizedName: normalizeLocalSubjectName(name),
      storageKey: name,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    state.customSubjects[id] = {
      id,
      storageKey: name,
      name,
      color: "#0f766e",
      tabId: UNASSIGNED_WORKSPACE_TAB_ID,
      createdAt: timestamp,
      targetWeekday: 0,
    }
  }

  const linkedByExplicitTab = new Set(Object.values(state.workspaceTabs).flatMap((tab) => tab.subjectIds))
  const unassignedSubjectIds: string[] = []
  for (const [subjectId, subject] of Object.entries(state.customSubjects)) {
    const isOnVisibleMain = subject.tabId === MAIN_WORKSPACE_TAB_ID && state.isMainWorkspaceTabVisible
    if (!isOnVisibleMain && !linkedByExplicitTab.has(subjectId)) {
      state.customSubjects[subjectId] = { ...subject, tabId: UNASSIGNED_WORKSPACE_TAB_ID }
      unassignedSubjectIds.push(subjectId)
    }
  }
  if (unassignedSubjectIds.length > 0) {
    const existingTab = state.workspaceTabs[UNASSIGNED_WORKSPACE_TAB_ID]
    state.workspaceTabs[UNASSIGNED_WORKSPACE_TAB_ID] = {
      id: UNASSIGNED_WORKSPACE_TAB_ID,
      name: UNASSIGNED_WORKSPACE_TAB_NAME,
      color: "#475569",
      createdAt: existingTab?.createdAt ?? timestamp,
      orderIndex: existingTab?.orderIndex ?? Object.keys(state.workspaceTabs).length,
      subjectIds: Array.from(new Set([...(existingTab?.subjectIds ?? []), ...unassignedSubjectIds])),
    }
  }

  for (const entry of Object.values(catalog.subjects)) {
    const existing = state.customSubjects[entry.id]
    const owningTab = Object.values(state.workspaceTabs).find((tab) => tab.subjectIds.includes(entry.id))?.id
    if (!existing && !owningTab) continue
    state.customSubjects[entry.id] = {
      id: entry.id,
      storageKey: entry.storageKey,
      name: entry.name,
      color: existing?.color ?? "#0f766e",
      tabId: existing?.tabId ?? owningTab ?? MAIN_WORKSPACE_TAB_ID,
      createdAt: existing?.createdAt ?? entry.createdAt,
      targetWeekday: existing?.targetWeekday ?? 0,
    }
  }

  const validIds = new Set(Object.keys(catalog.subjects))
  state.workspaceTabs = Object.fromEntries(Object.entries(state.workspaceTabs).map(([tabId, tab]) => [
    tabId,
    { ...tab, subjectIds: Array.from(new Set(tab.subjectIds.filter((id) => validIds.has(id)))) },
  ]))
  const visibleIds = new Set(Object.keys(state.customSubjects))
  catalog.subjects = Object.fromEntries(Object.entries(catalog.subjects).filter(([id]) => visibleIds.has(id)))
  return { state: normalizeLocalWorkspaceTabsState(state), catalog: normalizeLocalSubjectCatalog(catalog) }
}

let workspaceStateWriteQueue: Promise<unknown> = Promise.resolve()

async function readWorkspaceStateWithBackup() {
  try {
    const primary = await readJsonFile<Partial<LocalWorkspaceTabsState> | null>(WORKSPACE_STATE_MANIFEST, null)
    if (primary) return { state: normalizeLocalWorkspaceTabsState(primary), usedBackup: false }
  } catch (error) {
    console.error("Invalid primary workspace state; trying backup:", error)
  }
  try {
    const backup = await readJsonFile<Partial<LocalWorkspaceTabsState> | null>(WORKSPACE_STATE_BACKUP_MANIFEST, null)
    return { state: normalizeLocalWorkspaceTabsState(backup), usedBackup: Boolean(backup) }
  } catch (error) {
    console.error("Invalid backup workspace state; rebuilding from disk:", error)
    return { state: createEmptyWorkspaceTabsState(), usedBackup: false }
  }
}

async function ensureLocalReconciliationBackups() {
  const hasWorkspaceState = await jsonFileExists(WORKSPACE_STATE_MANIFEST)
  const needsRollingBackup = !(await jsonFileExists(WORKSPACE_STATE_BACKUP_MANIFEST))
  const needsMigrationBackup = !(await jsonFileExists(WORKSPACE_STATE_PRE_RECONCILIATION_MANIFEST))
  if (hasWorkspaceState && (needsRollingBackup || needsMigrationBackup)) {
    try {
      const current = await readJsonFile<Partial<LocalWorkspaceTabsState> | null>(WORKSPACE_STATE_MANIFEST, null)
      if (current) {
        const normalized = normalizeLocalWorkspaceTabsState(current)
        await Promise.all([
          needsRollingBackup ? writeJsonFile(WORKSPACE_STATE_BACKUP_MANIFEST, normalized) : Promise.resolve(),
          needsMigrationBackup ? writeJsonFile(WORKSPACE_STATE_PRE_RECONCILIATION_MANIFEST, normalized) : Promise.resolve(),
        ])
      }
    } catch {}
  }
  if (await jsonFileExists(MATERIAL_CONTAINERS_MANIFEST) && !(await jsonFileExists(MATERIAL_CONTAINERS_BACKUP_MANIFEST))) {
    const containers = await readJsonFile<Record<string, SubjectMaterialContainer[]>>(MATERIAL_CONTAINERS_MANIFEST, {})
    await writeJsonFile(MATERIAL_CONTAINERS_BACKUP_MANIFEST, containers)
  }
  if (await jsonFileExists(SUBJECT_CATALOG_MANIFEST) && !(await jsonFileExists(SUBJECT_CATALOG_V1_BACKUP_MANIFEST))) {
    const catalog = await readJsonFile<LegacyLocalSubjectCatalog | null>(SUBJECT_CATALOG_MANIFEST, null)
    if (catalog) await writeJsonFile(SUBJECT_CATALOG_V1_BACKUP_MANIFEST, catalog)
  }
}

async function writeLocalWorkspaceTabsStateFiles(state: LocalWorkspaceTabsState) {
  const normalizedState = normalizeLocalWorkspaceTabsState(state)
  try {
    const current = await readJsonFile<Partial<LocalWorkspaceTabsState> | null>(WORKSPACE_STATE_MANIFEST, null)
    if (current) await writeJsonFile(WORKSPACE_STATE_BACKUP_MANIFEST, normalizeLocalWorkspaceTabsState(current))
  } catch {}
  await writeJsonFile(WORKSPACE_STATE_MANIFEST, normalizedState)
  return normalizedState
}

export async function readLocalWorkspaceTabsState(): Promise<LocalWorkspaceTabsReadResult> {
  const exists = await jsonFileExists(WORKSPACE_STATE_MANIFEST)
  const loaded = await readWorkspaceStateWithBackup()
  return {
    state: loaded.state,
    exists: exists || loaded.usedBackup,
  }
}

export async function reconcileLocalWorkspaceTabsState(): Promise<LocalWorkspaceTabsReadResult> {
  const exists = await jsonFileExists(WORKSPACE_STATE_MANIFEST)
  await ensureLocalReconciliationBackups()
  const loaded = await readWorkspaceStateWithBackup()
  const catalogRead = await readLocalSubjectCatalogWithLegacy()
  const catalog = catalogRead.catalog
  const discoveredBeforeMigration = await discoverLocalSubjectSourceIds(loaded.state, catalog)
  const availableSources = new Set(discoveredBeforeMigration)
  const migrationPlans = buildSubjectFolderMigrationPlans(loaded.state, catalog, catalogRead.legacySources)
    .map((plan) => ({
      ...plan,
      sourceStorageKeys: plan.sourceStorageKeys.filter(
        (sourceId) => sourceId !== plan.targetStorageKey && availableSources.has(sourceId)
      ),
    }))
    .filter((plan) => plan.sourceStorageKeys.length > 0)
  await runSubjectFolderMigrations(migrationPlans)
  const recoveredScopes = await reconstructLocalMaterialManifests()
  const discoveredSourceIds = await discoverLocalSubjectSourceIds(loaded.state, catalog)
  const persistReconciliation = async () => {
    const latestLoaded = await readWorkspaceStateWithBackup()
    const latestCatalogRead = await readLocalSubjectCatalogWithLegacy()
    const reconciled = reconcileLocalSubjectCatalogState(
      latestLoaded.state,
      latestCatalogRead.catalog,
      discoveredSourceIds
    )
    const changed = JSON.stringify(reconciled.state) !== JSON.stringify(latestLoaded.state) ||
      JSON.stringify(reconciled.catalog) !== JSON.stringify(latestCatalogRead.catalog)
    if (changed || latestLoaded.usedBackup || !exists || latestCatalogRead.raw?.version !== 2) {
      await Promise.all([
        writeLocalWorkspaceTabsStateFiles(reconciled.state),
        writeLocalSubjectCatalog(reconciled.catalog),
      ])
    }
    return { reconciled, changed }
  }
  const pendingReconciliation = workspaceStateWriteQueue.then(persistReconciliation, persistReconciliation)
  workspaceStateWriteQueue = pendingReconciliation.then(() => undefined, () => undefined)
  const { reconciled, changed } = await pendingReconciliation
  await ensureLocalDefaultContainersForSubjects(Object.values(reconciled.catalog.subjects))
  await ensureLocalSubjectDirectories(Object.values(reconciled.catalog.subjects))
  if (recoveredScopes.length > 0 && typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel("subject-day-materials")
    for (const scope of recoveredScopes) {
      const logicalSubjectId = findCatalogSubjectByDirectoryName(reconciled.catalog, scope.subjectId)?.id ?? scope.subjectId
      channel.postMessage({ ...scope, subjectId: logicalSubjectId })
    }
    channel.close()
  }
  logWorkspaceDataSource({
    operation: "reconcileLocalWorkspaceTabsState",
    path: WORKSPACE_STATE_MANIFEST.join("/"),
    exists,
    workspaceTabs: Object.keys(reconciled.state.workspaceTabs).length,
    customSubjects: Object.keys(reconciled.state.customSubjects).length,
  })
  return {
    state: reconciled.state,
    exists: exists || changed,
  }
}

export async function saveLocalWorkspaceTabsState(state: Partial<LocalWorkspaceTabsState>) {
  const normalizedState = normalizeLocalWorkspaceTabsState(state)
  const write = () => writeLocalWorkspaceTabsStateFiles(normalizedState)
  const pending = workspaceStateWriteQueue.then(write, write)
  workspaceStateWriteQueue = pending.catch(() => undefined)
  await pending
  logWorkspaceDataSource({
    operation: "saveLocalWorkspaceTabsState",
    path: WORKSPACE_STATE_MANIFEST.join("/"),
    workspaceTabs: Object.keys(normalizedState.workspaceTabs).length,
    customSubjects: Object.keys(normalizedState.customSubjects).length,
  })
  return normalizedState
}

export async function ensureLocalSubjectForName(name: string) {
  let catalog = await readLocalSubjectCatalog()
  const safeName = createLocalSubjectDirectoryName(name)
  const existing = findCatalogSubjectByName(catalog, safeName) ?? findCatalogSubjectByDirectoryName(catalog, safeName)
  if (existing) {
    const updated = safeName === existing.storageKey && existing.name === safeName
      ? existing
      : {
          ...existing,
          name: safeName,
          normalizedName: normalizeLocalSubjectName(safeName),
          storageKey: safeName,
          updatedAt: new Date().toISOString(),
        }
    if (updated !== existing) {
      catalog = { ...catalog, subjects: { ...catalog.subjects, [updated.id]: updated } }
      await writeLocalSubjectCatalog(catalog)
    }
    await ensureLocalSubjectDirectories([updated])
    return updated
  }
  const id = allocateLocalSubjectStorageKey(catalog, safeName)
  const timestamp = new Date().toISOString()
  const entry: LocalSubjectCatalogEntry = {
    id,
    name: safeName,
    normalizedName: normalizeLocalSubjectName(safeName),
    storageKey: safeName,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  catalog = { ...catalog, subjects: { ...catalog.subjects, [entry.id]: entry } }
  await writeLocalSubjectCatalog(catalog)
  await ensureLocalSubjectDirectories([entry])
  await ensureLocalDefaultContainersForSubjects([entry])
  return entry
}

export async function renameLocalCatalogSubject(subjectId: string, name: string) {
  const catalog = await readLocalSubjectCatalog()
  const current = findCatalogSubjectByAnyId(catalog, subjectId)
  if (!current) return null
  const safeName = createLocalSubjectDirectoryName(name)
  const duplicate = findCatalogSubjectByName(catalog, safeName) ?? findCatalogSubjectByDirectoryName(catalog, safeName)
  if (duplicate && duplicate.id !== current.id) {
    await runSubjectFolderMigrations([{
      subjectId: duplicate.id,
      name: duplicate.name,
      targetStorageKey: duplicate.storageKey,
      sourceStorageKeys: [current.storageKey],
    }])
    const subjects = { ...catalog.subjects }
    delete subjects[current.id]
    await writeLocalSubjectCatalog({ version: 2, subjects })
    return duplicate
  }
  if (safeName !== current.storageKey) {
    await runSubjectFolderMigrations([{
      subjectId: current.id,
      name: safeName,
      targetStorageKey: safeName,
      sourceStorageKeys: [current.storageKey],
    }])
  }
  const updated: LocalSubjectCatalogEntry = {
    ...current,
    name: safeName,
    normalizedName: normalizeLocalSubjectName(safeName),
    storageKey: safeName,
    updatedAt: new Date().toISOString(),
  }
  await writeLocalSubjectCatalog({ ...catalog, subjects: { ...catalog.subjects, [updated.id]: updated } })
  await ensureLocalSubjectDirectories([updated])
  return updated
}

async function resolveLocalSubjectCatalogEntry(subjectId: string) {
  const catalog = await readLocalSubjectCatalog()
  return findCatalogSubjectByAnyId(catalog, subjectId)
}

async function resolveLocalSubjectSourceIds(subjectId: string) {
  const entry = await resolveLocalSubjectCatalogEntry(subjectId)
  return [entry?.storageKey ?? subjectId]
}

async function resolveLocalSubjectStorageKey(subjectId: string) {
  const entry = await resolveLocalSubjectCatalogEntry(subjectId)
  return entry?.storageKey ?? subjectId
}

async function resolveLocalLogicalSubjectId(subjectId: string) {
  const entry = await resolveLocalSubjectCatalogEntry(subjectId)
  return entry?.id ?? subjectId
}

export type LocalSubjectDeletionSummary = {
  subjectId: string
  name: string
  sourceIds: string[]
  materialCount: number
  entryCount: number
  fileCount: number
  directoryCount: number
}

export async function getLocalSubjectDeletionSummary(subjectId: string): Promise<LocalSubjectDeletionSummary> {
  const entry = await resolveLocalSubjectCatalogEntry(subjectId)
  const sourceIds = [entry?.storageKey ?? subjectId]
  let materialCount = 0
  let entryCount = 0
  let fileCount = 0
  let directoryCount = 0
  for (const sourceId of sourceIds) {
    for (const weekNumber of await listWeekNumbersForManifestKind(MATERIALS_DIR, sourceId)) {
      materialCount += (await readMaterialManifest(sourceId, weekNumber)).materials.length
    }
    for (const weekNumber of await listWeekNumbersForManifestKind(ENTRIES_DIR, sourceId)) {
      entryCount += (await readEntryManifest(sourceId, weekNumber)).entries.length
    }
    for (const base of [[THEORY_DIR], [PRACTICE_DIR], [AUDIO_DIR]] as string[][]) {
      const path = [...base, sourceId]
      if (await directoryExistsBySegments(path)) directoryCount += 1
      fileCount += await countFilesBySegments(path)
    }
  }
  return {
    subjectId: entry?.id ?? subjectId,
    name: entry?.name ?? subjectId,
    sourceIds,
    materialCount,
    entryCount,
    fileCount,
    directoryCount,
  }
}

export async function deleteLocalSubjectPermanently(subjectId: string) {
  const summary = await getLocalSubjectDeletionSummary(subjectId)
  const materialIds: number[] = []
  for (const sourceId of summary.sourceIds) {
    for (const weekNumber of await listWeekNumbersForManifestKind(MATERIALS_DIR, sourceId)) {
      materialIds.push(...(await readMaterialManifest(sourceId, weekNumber)).materials.map((material) => material.id))
    }
  }

  for (const sourceId of summary.sourceIds) {
    await Promise.all([
      removeDirectoryBySegments([THEORY_DIR, sourceId]),
      removeDirectoryBySegments([PRACTICE_DIR, sourceId]),
      removeDirectoryBySegments([AUDIO_DIR, sourceId]),
      removeDirectoryBySegments([MANIFESTS_DIR, MATERIALS_DIR, sourceId]),
      removeDirectoryBySegments([MANIFESTS_DIR, ENTRIES_DIR, sourceId]),
      removeDirectoryBySegments([MANIFESTS_DIR, "synthesis", sourceId]),
    ])
  }

  const [catalog, containers, tags, shortcuts, sessions, completions] = await Promise.all([
    readLocalSubjectCatalog(),
    readMaterialContainersManifest(),
    readTagManifest(),
    readShortcutsManifest(),
    readSessionsManifest(),
    readSubjectCompletionsManifest(),
  ])
  const subjects = { ...catalog.subjects }
  const catalogEntry = findCatalogSubjectByAnyId(catalog, subjectId)
  if (catalogEntry) delete subjects[catalogEntry.id]
  for (const sourceId of summary.sourceIds) {
    delete containers[sourceId]
    delete shortcuts[sourceId]
  }
  const deletedMaterialIds = new Set(materialIds.map(String))
  const deletedSourceIds = new Set([summary.subjectId, ...summary.sourceIds])
  const remainingSessions = Object.fromEntries(Object.entries(sessions).map(([date, session]) => [
    date,
    {
      ...session,
      active_subject_ids: session.active_subject_ids.filter((id) => !deletedSourceIds.has(id)),
      completed_subjects: Object.fromEntries(Object.entries(session.completed_subjects).filter(([id]) => !deletedSourceIds.has(id))),
    },
  ]))
  const remainingCompletions = Object.fromEntries(Object.entries(completions).filter(([, completion]) => !deletedSourceIds.has(completion.subject_id)))
  await Promise.all([
    writeLocalSubjectCatalog({ version: 2, subjects }),
    writeMaterialContainersManifest(containers),
    writeShortcutsManifest(shortcuts),
    writeSessionsManifest(remainingSessions),
    writeSubjectCompletionsManifest(remainingCompletions),
    writeTagManifest({
      ...tags,
      assignments: Object.fromEntries(Object.entries(tags.assignments).filter(([materialId]) => !deletedMaterialIds.has(materialId))),
      regions: Object.fromEntries(Object.entries(tags.regions).filter(([key]) => !materialIds.some((id) => key.startsWith(`${id}:`)))),
    }),
  ])
  return summary
}

function synthesisProgressPath(subjectId: string, weekNumber: number) {
  return [MANIFESTS_DIR, "synthesis", subjectId, `week-${weekNumber}.json`]
}

function hasMeaningfulSynthesisProgressItem(item: SubjectMaterialSynthesisRecord) {
  return (
    item.exerciseScopeText.trim().length > 0 ||
    item.exerciseSolvedCount > 0 ||
    item.exerciseTotalCount > 0
  )
}

function normalizeSynthesisProgressItems(items: SubjectMaterialSynthesisRecord[]) {
  return items.filter((item) => hasMeaningfulSynthesisProgressItem(item))
}

function coerceSynthesisProgressItems(
  items: Array<Omit<SubjectMaterialSynthesisRecord, "updatedAt"> & { updatedAt?: string | null }>
): SubjectMaterialSynthesisRecord[] {
  const timestamp = nowIso()
  return items.map((item) => ({
    ...item,
    exerciseScopeText: item.exerciseScopeText ?? "",
    exerciseSolvedCount: Math.max(0, Number(item.exerciseSolvedCount) || 0),
    exerciseTotalCount: Math.max(0, Number(item.exerciseTotalCount) || 0),
    updatedAt: item.updatedAt ?? timestamp,
  }))
}

async function readSynthesisProgressManifest(subjectId: string, weekNumber: number) {
  const payload = await readJsonFile<SubjectMaterialSynthesisRecord[] | null>(synthesisProgressPath(subjectId, weekNumber), null)
  return Array.isArray(payload) ? normalizeSynthesisProgressItems(payload) : []
}

async function writeSynthesisProgressManifest(
  subjectId: string,
  weekNumber: number,
  items: SubjectMaterialSynthesisRecord[]
) {
  const normalizedItems = normalizeSynthesisProgressItems(items)
  if (normalizedItems.length === 0) {
    await deleteJsonFile(synthesisProgressPath(subjectId, weekNumber))
    return
  }

  await writeJsonFile(synthesisProgressPath(subjectId, weekNumber), normalizedItems)
}

async function readSocraticSettingsManifest() {
  const payload = await readJsonFile<SocraticReviewSettings | null>([MANIFESTS_DIR, "socratic-settings.json"], null)
  return payload && typeof payload === "object" ? payload : { selectedModel: null }
}

async function writeSocraticSettingsManifest(value: SocraticReviewSettings) {
  await writeJsonFile([MANIFESTS_DIR, "socratic-settings.json"], value)
}

async function readSocraticTurnsManifest() {
  const payload = await readJsonFile<SocraticReviewGeneratedTurn[] | null>([MANIFESTS_DIR, "socratic-turns.json"], null)
  return Array.isArray(payload) ? payload : []
}

async function writeSocraticTurnsManifest(value: SocraticReviewGeneratedTurn[]) {
  await writeJsonFile([MANIFESTS_DIR, "socratic-turns.json"], value)
}

type CronogramaManifest = {
  version: 1
  fileName: string
  driveFileId: string
  driveMimeType: string
  updatedAt: string
} | null

async function readCronogramaManifest(): Promise<CronogramaManifest> {
  return readJsonFile<CronogramaManifest>([MANIFESTS_DIR, "cronograma.json"], null)
}

async function writeCronogramaManifest(value: Exclude<CronogramaManifest, null>) {
  await writeJsonFile([MANIFESTS_DIR, "cronograma.json"], value)
}

async function readMaterialManifest(subjectId: string, weekNumber: number): Promise<MaterialManifest> {
  const payload = await readJsonFile<MaterialManifest | null>(materialManifestPath(subjectId, weekNumber), null)
  return payload ?? {
    version: 1,
    subjectId,
    weekNumber,
    materials: [],
  }
}

async function writeMaterialManifest(subjectId: string, weekNumber: number, materials: SubjectDayMaterial[]) {
  const sortedMaterials = sortMaterials(materials)
  if (sortedMaterials.length === 0) {
    await deleteJsonFile(materialManifestPath(subjectId, weekNumber))
    return
  }

  await writeJsonFile(materialManifestPath(subjectId, weekNumber), {
    version: 1,
    subjectId,
    weekNumber,
    materials: sortedMaterials,
  } satisfies MaterialManifest)
}

async function readTagManifest(): Promise<TagManifest> {
  const payload = await readJsonFile<TagManifest | null>(TAGS_MANIFEST, null)
  if (!payload) return { version: 2, tags: [], assignments: {}, regions: {} }

  const assignments: Record<string, number[]> = {}
  for (const [materialId, tagIds] of Object.entries(payload.assignments ?? {})) {
    assignments[materialId] = Array.from(
      new Set((Array.isArray(tagIds) ? tagIds : []).map(Number).filter(Number.isInteger))
    )
  }
  return {
    version: 2,
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    assignments,
    regions: payload.regions && typeof payload.regions === "object" ? payload.regions : {},
  }
}

async function writeTagManifest(manifest: TagManifest) {
  await writeJsonFile(TAGS_MANIFEST, manifest)
}

function withLocalTagUsageCounts(manifest: TagManifest) {
  const counts = new Map<number, number>()
  for (const tagIds of Object.values(manifest.assignments)) {
    for (const tagId of new Set(tagIds)) {
      counts.set(tagId, (counts.get(tagId) ?? 0) + 1)
    }
  }
  return manifest.tags
    .map((tag) => ({ ...tag, usageCount: counts.get(tag.id) ?? 0 }))
    .sort((left, right) => left.name.localeCompare(right.name, "es"))
}

export async function listLocalMaterialTagWorkspace(scope: {
  subjectId: string
  weekNumber?: number
  sessionDate?: string
}): Promise<MaterialTagWorkspace> {
  const manifest = await readTagManifest()
  const visibleMaterialIds = new Set<number>()
  if (Number.isInteger(scope.weekNumber)) {
    const materials = await listLocalSubjectDayMaterials({
      subjectId: scope.subjectId,
      weekNumber: Number(scope.weekNumber),
      sessionDate: scope.sessionDate,
    })
    materials.forEach((material) => visibleMaterialIds.add(material.id))
  } else {
    const weekNumbers = await listLocalSubjectWeekNumbersWithContent(scope.subjectId)
    for (const weekNumber of weekNumbers) {
      const materials = await listLocalSubjectDayMaterials({
        subjectId: scope.subjectId,
        weekNumber,
        sessionDate: scope.sessionDate,
      })
      materials.forEach((material) => visibleMaterialIds.add(material.id))
    }
  }

  const assignments: Record<string, number[]> = {}
  for (const materialId of visibleMaterialIds) {
    assignments[String(materialId)] = [...(manifest.assignments[String(materialId)] ?? [])]
  }
  const regionCounts: Record<string, Record<string, number>> = {}
  for (const [key, regions] of Object.entries(manifest.regions)) {
    const [materialId, tagId] = key.split(":")
    if (!visibleMaterialIds.has(Number(materialId)) || !Array.isArray(regions) || regions.length === 0) continue
    regionCounts[materialId] ??= {}
    regionCounts[materialId][tagId] = regions.length
  }
  return { tags: withLocalTagUsageCounts(manifest), assignments, regionCounts }
}

export async function listLocalTagsForMaterial(materialId: number) {
  const manifest = await readTagManifest()
  const assigned = new Set(manifest.assignments[String(materialId)] ?? [])
  return withLocalTagUsageCounts(manifest).filter((tag) => assigned.has(tag.id))
}

export async function createLocalMaterialTag(input: {
  name: string
  color?: string
  parentId?: number | null
}) {
  const manifest = await readTagManifest()
  const name = normalizeTagDisplayName(input.name)
  const normalizedName = normalizeTagName(input.name)
  if (!name || !normalizedName) throw new Error("El tag necesita un nombre.")
  const existing = manifest.tags.find((tag) => tag.normalizedName === normalizedName)
  if (existing) {
    return {
      tag: withLocalTagUsageCounts(manifest).find((tag) => tag.id === existing.id)!,
      created: false,
    }
  }
  const parentId = Number.isInteger(input.parentId) ? Number(input.parentId) : null
  if (parentId != null && !manifest.tags.some((tag) => tag.id === parentId)) {
    throw new Error("El tag padre no existe.")
  }
  const timestamp = nowIso()
  const tag: StudyTag = {
    id: nextLocalId(),
    name,
    normalizedName,
    color: normalizeTagColor(input.color || ""),
    parentId,
    usageCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  await writeTagManifest({ ...manifest, tags: [...manifest.tags, tag] })
  return { tag, created: true }
}

export async function updateLocalMaterialTag(
  tagId: number,
  input: { name?: string; color?: string; parentId?: number | null }
) {
  const manifest = await readTagManifest()
  const current = manifest.tags.find((tag) => tag.id === tagId)
  if (!current) return null
  const name = input.name === undefined ? current.name : normalizeTagDisplayName(input.name)
  const normalizedName = input.name === undefined ? current.normalizedName : normalizeTagName(input.name)
  if (!name || !normalizedName) throw new Error("El tag necesita un nombre.")
  if (manifest.tags.some((tag) => tag.id !== tagId && tag.normalizedName === normalizedName)) {
    throw new Error("Ya existe un tag con ese nombre.")
  }
  const parentId = input.parentId === undefined
    ? current.parentId
    : Number.isInteger(input.parentId)
      ? Number(input.parentId)
      : null
  const parentMap = new Map(manifest.tags.map((tag) => [tag.id, tag.parentId]))
  if (wouldCreateTagCycle(tagId, parentId, parentMap)) {
    throw new Error("La jerarquia produciria un ciclo.")
  }
  if (parentId != null && !parentMap.has(parentId)) throw new Error("El tag padre no existe.")
  const updated: StudyTag = {
    ...current,
    name,
    normalizedName,
    color: input.color === undefined ? current.color : normalizeTagColor(input.color),
    parentId,
    updatedAt: nowIso(),
  }
  const nextManifest = {
    ...manifest,
    tags: manifest.tags.map((tag) => (tag.id === tagId ? updated : tag)),
  }
  await writeTagManifest(nextManifest)
  return withLocalTagUsageCounts(nextManifest).find((tag) => tag.id === tagId)!
}

export async function mergeLocalMaterialTags(sourceTagId: number, targetTagId: number) {
  if (sourceTagId === targetTagId) throw new Error("La fusion solicitada no es valida.")
  const manifest = await readTagManifest()
  if (!manifest.tags.some((tag) => tag.id === sourceTagId) || !manifest.tags.some((tag) => tag.id === targetTagId)) {
    return null
  }
  const parentMap = new Map(manifest.tags.map((tag) => [tag.id, tag.parentId]))
  if (wouldCreateTagCycle(sourceTagId, targetTagId, parentMap)) {
    throw new Error("La fusion produciria un ciclo.")
  }
  const assignments = Object.fromEntries(
    Object.entries(manifest.assignments).map(([materialId, tagIds]) => [
      materialId,
      Array.from(new Set(tagIds.map((tagId) => (tagId === sourceTagId ? targetTagId : tagId)))),
    ])
  )
  const regions: Record<string, MaterialTagRegion[]> = {}
  for (const [key, tagRegions] of Object.entries(manifest.regions)) {
    const targetKey = key.endsWith(`:${sourceTagId}`)
      ? `${key.slice(0, key.lastIndexOf(":"))}:${targetTagId}`
      : key
    const moved = tagRegions.map((region) =>
      region.tagId === sourceTagId ? { ...region, tagId: targetTagId } : region
    )
    regions[targetKey] = [...(regions[targetKey] ?? []), ...moved]
      .map((region, orderIndex) => ({ ...region, orderIndex }))
  }
  const nextManifest: TagManifest = {
    version: 2,
    tags: manifest.tags
      .filter((tag) => tag.id !== sourceTagId)
      .map((tag) => (tag.parentId === sourceTagId ? { ...tag, parentId: targetTagId, updatedAt: nowIso() } : tag)),
    assignments,
    regions,
  }
  await writeTagManifest(nextManifest)
  return withLocalTagUsageCounts(nextManifest).find((tag) => tag.id === targetTagId)!
}

export async function deleteLocalMaterialTag(tagId: number, force: boolean) {
  const manifest = await readTagManifest()
  const tag = withLocalTagUsageCounts(manifest).find((candidate) => candidate.id === tagId)
  if (!tag) return { deleted: false, missing: true, usageCount: 0 }
  if (tag.usageCount > 0 && !force) return { deleted: false, missing: false, usageCount: tag.usageCount }
  const assignments = Object.fromEntries(
    Object.entries(manifest.assignments).map(([materialId, tagIds]) => [
      materialId,
      tagIds.filter((candidate) => candidate !== tagId),
    ])
  )
  await writeTagManifest({
    version: 2,
    tags: manifest.tags
      .filter((candidate) => candidate.id !== tagId)
      .map((candidate) => candidate.parentId === tagId ? { ...candidate, parentId: null } : candidate),
    assignments,
    regions: Object.fromEntries(
      Object.entries(manifest.regions).filter(([key]) => !key.endsWith(`:${tagId}`))
    ),
  })
  return { deleted: true, missing: false, usageCount: tag.usageCount }
}

export async function assignLocalTagToMaterial(
  materialId: number,
  tagId: number,
  scope?: { subjectId?: string; weekNumber?: number }
) {
  const scopedMaterial =
    scope?.subjectId && Number.isInteger(scope.weekNumber)
      ? (await readMaterialManifest(scope.subjectId, Number(scope.weekNumber)))
          .materials.find((candidate) => candidate.id === materialId) ?? null
      : null
  const material = scopedMaterial ?? await findMaterialById(materialId)
  if (!material) return null
  const manifest = await readTagManifest()
  if (!manifest.tags.some((tag) => tag.id === tagId)) return null
  const key = String(materialId)
  const assignments = {
    ...manifest.assignments,
    [key]: Array.from(new Set([...(manifest.assignments[key] ?? []), tagId])),
  }
  await writeTagManifest({ ...manifest, assignments })
  return listLocalTagsForMaterial(materialId)
}

export async function unassignLocalTagFromMaterial(materialId: number, tagId: number) {
  const manifest = await readTagManifest()
  const key = String(materialId)
  await writeTagManifest({
    ...manifest,
    assignments: {
      ...manifest.assignments,
      [key]: (manifest.assignments[key] ?? []).filter((candidate) => candidate !== tagId),
    },
    regions: Object.fromEntries(
      Object.entries(manifest.regions).filter(([regionKey]) => regionKey !== `${materialId}:${tagId}`)
    ),
  })
  return listLocalTagsForMaterial(materialId)
}

async function readMaterialContainersManifest() {
  return readJsonFile<Record<string, SubjectMaterialContainer[]>>(MATERIAL_CONTAINERS_MANIFEST, {})
}

async function writeMaterialContainersManifest(value: Record<string, SubjectMaterialContainer[]>) {
  await writeJsonFile(MATERIAL_CONTAINERS_MANIFEST, value)
}

function buildDefaultLocalSubjectContainers(storageKey: string, timestamp = nowIso()): SubjectMaterialContainer[] {
  return [
    {
      id: stableLocalMaterialId(`container:${storageKey}:theory`),
      subjectId: storageKey,
      name: "Teoría",
      normalizedName: "teoría",
      kind: "theory",
      isPinned: false,
      orderIndex: 0,
      materialCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: stableLocalMaterialId(`container:${storageKey}:practice`),
      subjectId: storageKey,
      name: "Práctica",
      normalizedName: "práctica",
      kind: "practice",
      isPinned: false,
      orderIndex: 1,
      materialCount: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ]
}

async function ensureLocalDefaultContainersForSubjects(subjects: LocalSubjectCatalogEntry[]) {
  const manifest = await readMaterialContainersManifest()
  let changed = false
  for (const subject of subjects) {
    const current = manifest[subject.storageKey]
    if (Array.isArray(current) && current.some((container) => container.kind === "theory") && current.some((container) => container.kind === "practice")) {
      continue
    }
    const custom = Array.isArray(current) ? current.filter((container) => container.kind === "custom") : []
    manifest[subject.storageKey] = [...buildDefaultLocalSubjectContainers(subject.storageKey), ...custom]
    changed = true
  }
  if (changed) {
    const latestManifest = await readMaterialContainersManifest()
    for (const subject of subjects) {
      const current = latestManifest[subject.storageKey]
      if (Array.isArray(current) && current.some((container) => container.kind === "theory") && current.some((container) => container.kind === "practice")) {
        continue
      }
      const custom = Array.isArray(current) ? current.filter((container) => container.kind === "custom") : []
      latestManifest[subject.storageKey] = [...buildDefaultLocalSubjectContainers(subject.storageKey), ...custom]
    }
    await writeMaterialContainersManifest(latestManifest)
  }
}

export async function listLocalSubjectMaterialContainers(subjectId: string) {
  const manifest = await readMaterialContainersManifest()
  const storageKey = await resolveLocalSubjectStorageKey(subjectId)
  const sourceIds = await resolveLocalSubjectSourceIds(subjectId)
  let containers = manifest[storageKey]
  if (!Array.isArray(containers) || !containers.some((container) => container.kind === "theory") || !containers.some((container) => container.kind === "practice")) {
    const existing = Array.isArray(containers) ? containers.filter((container) => container.kind === "custom") : []
    containers = [...buildDefaultLocalSubjectContainers(storageKey), ...existing]
  }
  const aliasCustomContainers = sourceIds
    .filter((sourceId) => sourceId !== storageKey)
    .flatMap((sourceId) => (manifest[sourceId] ?? []).filter((container) => container.kind === "custom"))
  containers = [
    ...containers,
    ...aliasCustomContainers.filter((container) => !containers.some((current) => current.id === container.id)),
  ]
  const counts = new Map<number, number>()
  for (const sourceId of sourceIds) {
    for (const weekNumber of await listWeekNumbersForManifestKind(MATERIALS_DIR, sourceId)) {
      const materials = (await readMaterialManifest(sourceId, weekNumber)).materials
      for (const material of materials) {
        const container = material.container_id == null
          ? containers.find((candidate) => candidate.kind === material.material_type)
          : containers.find((candidate) => candidate.id === material.container_id) ??
            containers.find((candidate) => candidate.kind === material.material_type)
        if (container) counts.set(container.id, (counts.get(container.id) ?? 0) + 1)
      }
    }
  }
  return containers
    .map((container) => ({
      ...container,
      isPinned: container.kind === "custom" && Boolean(container.isPinned),
      materialCount: counts.get(container.id) ?? 0,
    }))
    .sort((left, right) => {
      const leftKind = left.kind === "theory" ? 0 : left.kind === "practice" ? 1 : 2
      const rightKind = right.kind === "theory" ? 0 : right.kind === "practice" ? 1 : 2
      if (leftKind !== rightKind) return leftKind - rightKind
      if (left.kind === "custom" && right.kind === "custom" && left.isPinned !== right.isPinned) {
        return left.isPinned ? -1 : 1
      }
      return left.orderIndex - right.orderIndex || left.id - right.id
    })
}

export async function createLocalSubjectMaterialContainer(subjectId: string, rawName: string) {
  const storageKey = await resolveLocalSubjectStorageKey(subjectId)
  const name = normalizeTagDisplayName(rawName)
  const normalizedName = normalizeTagName(rawName)
  if (!name || !normalizedName) throw new Error("El nombre es obligatorio.")
  const containers = await listLocalSubjectMaterialContainers(subjectId)
  if (containers.some((container) => container.normalizedName === normalizedName)) {
    throw new Error("Ya existe un contenedor con ese nombre.")
  }
  const timestamp = nowIso()
  const container: SubjectMaterialContainer = {
    id: nextLocalId(),
    subjectId: storageKey,
    name,
    normalizedName,
    kind: "custom",
    isPinned: false,
    orderIndex: Math.max(1, ...containers.map((candidate) => candidate.orderIndex)) + 1,
    materialCount: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  const manifest = await readMaterialContainersManifest()
  manifest[storageKey] = [...containers.filter((candidate) => candidate.subjectId === storageKey), container]
    .map((candidate) => ({ ...candidate, materialCount: 0 }))
  await writeMaterialContainersManifest(manifest)
  return container
}

export async function renameLocalSubjectMaterialContainer(containerId: number, rawName: string) {
  const manifest = await readMaterialContainersManifest()
  for (const [subjectId, stored] of Object.entries(manifest)) {
    const containers = await listLocalSubjectMaterialContainers(subjectId)
    const current = containers.find((container) => container.id === containerId)
    if (!current) continue
    if (current.kind !== "custom") throw new Error("Teoría y Práctica son contenedores fijos.")
    const name = normalizeTagDisplayName(rawName)
    const normalizedName = normalizeTagName(rawName)
    if (!name || !normalizedName) throw new Error("El nombre es obligatorio.")
    if (containers.some((container) => container.id !== containerId && container.normalizedName === normalizedName)) {
      throw new Error("Ya existe un contenedor con ese nombre.")
    }
    const updated = { ...current, name, normalizedName, updatedAt: nowIso() }
    manifest[subjectId] = stored.map((container) => container.id === containerId ? updated : container)
    await writeMaterialContainersManifest(manifest)
    return updated
  }
  return null
}

function persistLocalCustomOrder(
  manifest: Record<string, SubjectMaterialContainer[]>,
  ordered: SubjectMaterialContainer[]
) {
  const orderById = new Map(ordered.map((container, index) => [container.id, index + 2]))
  for (const [subjectId, stored] of Object.entries(manifest)) {
    manifest[subjectId] = stored.map((container) => {
      const nextOrder = orderById.get(container.id)
      return nextOrder == null ? container : { ...container, orderIndex: nextOrder, updatedAt: nowIso() }
    })
  }
}

export async function setLocalSubjectMaterialContainerPinned(containerId: number, isPinned: boolean) {
  const manifest = await readMaterialContainersManifest()
  const owner = Object.entries(manifest).find(([, stored]) => stored.some((container) => container.id === containerId))
  if (!owner) return null
  const [subjectId] = owner
  const containers = await listLocalSubjectMaterialContainers(subjectId)
  const current = containers.find((container) => container.id === containerId)
  if (!current) return null
  if (current.kind !== "custom") throw new Error("Teoría y Práctica son contenedores fijos.")

  for (const [key, stored] of Object.entries(manifest)) {
    manifest[key] = stored.map((container) =>
      container.id === containerId ? { ...container, isPinned, updatedAt: nowIso() } : container
    )
  }
  const others = containers.filter((container) => container.kind === "custom" && container.id !== containerId)
  const pinned = others.filter((container) => container.isPinned)
  const unpinned = others.filter((container) => !container.isPinned)
  const updated = { ...current, isPinned }
  persistLocalCustomOrder(manifest, isPinned ? [...pinned, updated, ...unpinned] : [...pinned, ...unpinned, updated])
  await writeMaterialContainersManifest(manifest)
  return { ...updated, orderIndex: isPinned ? pinned.length + 2 : pinned.length + unpinned.length + 2 }
}

export async function moveLocalSubjectMaterialContainer(containerId: number, direction: "up" | "down") {
  const manifest = await readMaterialContainersManifest()
  const owner = Object.entries(manifest).find(([, stored]) => stored.some((container) => container.id === containerId))
  if (!owner) return null
  const [subjectId] = owner
  const custom = (await listLocalSubjectMaterialContainers(subjectId)).filter((container) => container.kind === "custom")
  const current = custom.find((container) => container.id === containerId)
  if (!current) return null
  const pinned = custom.filter((container) => container.isPinned)
  const unpinned = custom.filter((container) => !container.isPinned)
  const group = current.isPinned ? pinned : unpinned
  const currentIndex = group.findIndex((container) => container.id === containerId)
  const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1
  if (currentIndex < 0 || nextIndex < 0 || nextIndex >= group.length) return current
  const reordered = [...group]
  ;[reordered[currentIndex], reordered[nextIndex]] = [reordered[nextIndex], reordered[currentIndex]]
  persistLocalCustomOrder(manifest, current.isPinned ? [...reordered, ...unpinned] : [...pinned, ...reordered])
  await writeMaterialContainersManifest(manifest)
  return { ...current, orderIndex: nextIndex + (current.isPinned ? 2 : pinned.length + 2), updatedAt: nowIso() }
}

export async function deleteLocalSubjectMaterialContainer(containerId: number) {
  const manifest = await readMaterialContainersManifest()
  for (const [subjectId, stored] of Object.entries(manifest)) {
    const containers = await listLocalSubjectMaterialContainers(subjectId)
    const current = containers.find((container) => container.id === containerId)
    if (!current) continue
    if (current.kind !== "custom") throw new Error("Teoría y Práctica son contenedores fijos.")
    if (current.materialCount > 0) throw new Error(`El contenedor contiene ${current.materialCount} PDF${current.materialCount === 1 ? "" : "s"}.`)
    manifest[subjectId] = stored.filter((container) => container.id !== containerId)
    await writeMaterialContainersManifest(manifest)
    return { deleted: true, materialCount: 0 }
  }
  return null
}

export async function listLocalMaterialTagRegions(materialId: number, tagId: number) {
  const manifest = await readTagManifest()
  return [...(manifest.regions[`${materialId}:${tagId}`] ?? [])]
    .sort((left, right) => left.orderIndex - right.orderIndex)
}

export async function replaceLocalMaterialTagRegions(
  materialId: number,
  tagId: number,
  regions: MaterialTagRegion[]
) {
  const manifest = await readTagManifest()
  if (!(manifest.assignments[String(materialId)] ?? []).includes(tagId)) {
    throw new Error("El tag no está asignado a este material.")
  }
  const normalized = regions.map((region, orderIndex) => ({
    materialId,
    tagId,
    pageNumber: region.pageNumber,
    pageRotation: region.pageRotation,
    x1: region.x1,
    y1: region.y1,
    x2: region.x2,
    y2: region.y2,
    orderIndex,
    createdAt: region.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  }))
  await writeTagManifest({
    ...manifest,
    version: 2,
    regions: { ...manifest.regions, [`${materialId}:${tagId}`]: normalized },
  })
  return normalized
}

async function readEntryManifest(subjectId: string, weekNumber: number): Promise<EntryManifest> {
  const payload = await readJsonFile<EntryManifest | null>(entryManifestPath(subjectId, weekNumber), null)
  return payload ?? {
    version: 1,
    subjectId,
    weekNumber,
    entries: [],
  }
}

async function writeEntryManifest(subjectId: string, weekNumber: number, entries: SubjectDayEntry[]) {
  const sortedEntries = sortEntries(entries).map(withEntryDefaults)
  if (sortedEntries.length === 0) {
    await deleteJsonFile(entryManifestPath(subjectId, weekNumber))
    return
  }

  await writeJsonFile(entryManifestPath(subjectId, weekNumber), {
    version: 1,
    subjectId,
    weekNumber,
    entries: sortedEntries,
  } satisfies EntryManifest)
}

async function listWeekNumbersForManifestKind(kind: "materials" | "entries", subjectId: string) {
  const rootHandle = await ensureWorkspaceRootHandle()
  const manifestRoot = await getDirectoryHandleBySegments(rootHandle, [MANIFESTS_DIR, kind, subjectId], false).catch(() => null)
  if (!manifestRoot) return []

  const weekNumbers: number[] = []
  for await (const [name] of manifestRoot.entries()) {
    const match = /^week-(\d+)\.json$/i.exec(name)
    if (match) {
      const weekNumber = Number.parseInt(match[1], 10)
      weekNumbers.push(weekNumber)
    }
  }
  return weekNumbers
}

async function listSynthesisWeekNumbersForSubject(subjectId: string) {
  const rootHandle = await ensureWorkspaceRootHandle()
  const manifestRoot = await getDirectoryHandleBySegments(rootHandle, [MANIFESTS_DIR, "synthesis", subjectId], false).catch(() => null)
  if (!manifestRoot) return []

  const weekNumbers: number[] = []
  for await (const [name] of manifestRoot.entries()) {
    const match = /^week-(\d+)\.json$/i.exec(name)
    if (!match) continue

    weekNumbers.push(Number.parseInt(match[1], 10))
  }

  return weekNumbers
}

async function listManifestSubjectIds(kind: typeof MATERIALS_DIR | typeof ENTRIES_DIR) {
  const rootHandle = await ensureWorkspaceRootHandle()
  const manifestRoot = await getDirectoryHandleBySegments(rootHandle, [MANIFESTS_DIR, kind], false).catch(() => null)
  if (!manifestRoot) return [] as string[]

  const subjectIds: string[] = []
  for await (const [name, handle] of manifestRoot.entries()) {
    if (handle.kind !== "directory") continue
    subjectIds.push(name)
  }

  return subjectIds
}

async function listKnownLocalSubjectIds() {
  const [materialSubjectIds, entrySubjectIds] = await Promise.all([
    listManifestSubjectIds(MATERIALS_DIR),
    listManifestSubjectIds(ENTRIES_DIR),
  ])

  return Array.from(new Set([...SUBJECTS.map((subject) => subject.id), ...materialSubjectIds, ...entrySubjectIds]))
}

async function findMaterialById(materialId: number): Promise<SubjectDayMaterial | null> {
  const subjectIds = await listKnownLocalSubjectIds()
  for (const subjectId of subjectIds) {
    const weekNumbers = await listWeekNumbersForManifestKind(MATERIALS_DIR, subjectId)
    for (const weekNumber of weekNumbers) {
      const manifest = await readMaterialManifest(subjectId, weekNumber)
      const material = manifest.materials.find((candidate) => candidate.id === materialId)
      if (material) return material
    }
  }
  return null
}

async function findEntryById(entryId: number): Promise<SubjectDayEntry | null> {
  const subjectIds = await listKnownLocalSubjectIds()
  for (const subjectId of subjectIds) {
    const weekNumbers = await listWeekNumbersForManifestKind(ENTRIES_DIR, subjectId)
    for (const weekNumber of weekNumbers) {
      const manifest = await readEntryManifest(subjectId, weekNumber)
      const entry = manifest.entries.find((candidate) => candidate.id === entryId)
      if (entry) return withEntryDefaults(entry)
    }
  }
  return null
}

function getMaterialRelativePath(params: {
  subjectId: string
  weekNumber: number
  sessionDate: string
  materialType: SubjectDayMaterialType
  fileName: string
}) {
  const baseDir = params.materialType === "theory" ? THEORY_DIR : PRACTICE_DIR
  return joinWorkspaceId(
    baseDir,
    createLocalSubjectDirectoryName(params.subjectId),
    `week-${params.weekNumber}`,
    params.sessionDate,
    `${Date.now()}-${sanitizePathSegment(normalizePdfFileName(params.fileName))}`
  )
}

function getAudioRelativePath(params: {
  subjectId: string
  weekNumber: number
  sessionDate: string
  fileName: string
}) {
  return joinWorkspaceId(
    AUDIO_DIR,
    createLocalSubjectDirectoryName(params.subjectId),
    `week-${params.weekNumber}`,
    params.sessionDate,
    `${Date.now()}-${sanitizePathSegment(params.fileName)}`
  )
}

function getCronogramaRelativePath(fileName: string) {
  return joinWorkspaceId(CRONOGRAMA_DIR, `${Date.now()}-${sanitizePathSegment(normalizePdfFileName(fileName))}`)
}

export async function getLocalAiPrompt() {
  return readAiPromptValue()
}

export async function saveLocalAiPrompt(prompt: string) {
  await writeAiPromptValue(prompt)
  return { prompt }
}

export async function getLocalSynthesisProgress(subjectId: string, weekNumber: number) {
  const sourceIds = await resolveLocalSubjectSourceIds(subjectId)
  const groups = await Promise.all(sourceIds.map((sourceId) => readSynthesisProgressManifest(sourceId, weekNumber)))
  return Array.from(new Map(groups.flat().map((item) => [item.subjectDayMaterialId, item])).values())
}

export async function saveLocalSynthesisProgress(
  subjectId: string,
  weekNumber: number,
  items: Array<Omit<SubjectMaterialSynthesisRecord, "updatedAt"> & { updatedAt?: string | null }>
) {
  const storageKey = await resolveLocalSubjectStorageKey(subjectId)
  const normalizedItems = coerceSynthesisProgressItems(items)
  await writeSynthesisProgressManifest(storageKey, weekNumber, normalizedItems)
  return normalizedItems
}

export async function hasLocalWeekContent(subjectId: string, weekNumber: number) {
  const [materialManifest, entryManifest, synthesisItems] = await Promise.all([
    readMaterialManifest(subjectId, weekNumber),
    readEntryManifest(subjectId, weekNumber),
    readSynthesisProgressManifest(subjectId, weekNumber),
  ])

  return materialManifest.materials.length > 0 || entryManifest.entries.length > 0 || synthesisItems.length > 0
}

export async function cleanupLocalSubjectWeekIfEmpty(subjectId: string, weekNumber: number) {
  const [hasMaterialManifest, hasEntryManifest, hasSynthesisManifest] = await Promise.all([
    jsonFileExists(materialManifestPath(subjectId, weekNumber)),
    jsonFileExists(entryManifestPath(subjectId, weekNumber)),
    jsonFileExists(synthesisProgressPath(subjectId, weekNumber)),
  ])
  const hadPersistedArtifacts = hasMaterialManifest || hasEntryManifest || hasSynthesisManifest
  const hasContent = await hasLocalWeekContent(subjectId, weekNumber)

  if (hasContent) {
    return {
      hasContent: true,
      cleaned: false,
      hadPersistedArtifacts,
    }
  }

  await Promise.all([
    hasMaterialManifest ? deleteJsonFile(materialManifestPath(subjectId, weekNumber)) : Promise.resolve(),
    hasEntryManifest ? deleteJsonFile(entryManifestPath(subjectId, weekNumber)) : Promise.resolve(),
    hasSynthesisManifest ? deleteJsonFile(synthesisProgressPath(subjectId, weekNumber)) : Promise.resolve(),
  ])

  return {
    hasContent: false,
    cleaned: hadPersistedArtifacts,
    hadPersistedArtifacts,
  }
}

export async function findNearestWeekWithContent(subjectId: string, fromWeekNumber: number, direction: -1 | 1) {
  const weekNumbers = await listLocalSubjectWeekNumbersWithContent(subjectId)
  if (direction > 0) {
    return [...weekNumbers]
      .sort((left, right) => left - right)
      .find((weekNumber) => weekNumber > fromWeekNumber) ?? null
  }

  return [...weekNumbers]
    .sort((left, right) => right - left)
    .find((weekNumber) => weekNumber < fromWeekNumber) ?? null
}

export async function listLocalSubjectWeekNumbersWithContent(subjectId: string) {
  const sourceIds = await resolveLocalSubjectSourceIds(subjectId)
  const groups = await Promise.all(sourceIds.map(async (sourceId) => {
    const [materialWeeks, entryWeeks, synthesisWeeks] = await Promise.all([
      listWeekNumbersForManifestKind(MATERIALS_DIR, sourceId),
      listWeekNumbersForManifestKind(ENTRIES_DIR, sourceId),
      listSynthesisWeekNumbersForSubject(sourceId),
    ])
    return [...materialWeeks, ...entryWeeks, ...synthesisWeeks]
  }))

  return Array.from(new Set(groups.flat())).sort((left, right) => right - left)
}

export async function listLocalWeekNumbersWithContent(subjectIds: string[]) {
  const weeksBySubject = await Promise.all(subjectIds.map((subjectId) => listLocalSubjectWeekNumbersWithContent(subjectId)))
  return Array.from(new Set(weeksBySubject.flat())).sort((left, right) => right - left)
}

export async function getLatestLocalSubjectContentDate(subjectId: string, weekNumber: number) {
  const [materials, entries] = await Promise.all([
    listLocalSubjectDayMaterials({ subjectId, weekNumber }),
    listLocalSubjectDayEntries({ subjectId, weekNumber }),
  ])
  return [...materials.map((material) => material.session_date), ...entries.map((entry) => entry.session_date)]
    .filter(Boolean)
    .sort((left, right) => right.localeCompare(left))[0] ?? null
}

export async function getLocalSocraticReviewSettings() {
  return readSocraticSettingsManifest()
}

export async function saveLocalSocraticReviewSettings(selectedModel: string | null) {
  const payload = { selectedModel: selectedModel || null }
  await writeSocraticSettingsManifest(payload)
  return payload
}

export async function appendLocalSocraticReviewTurn(turn: SocraticReviewGeneratedTurn) {
  const turns = await readSocraticTurnsManifest()
  await writeSocraticTurnsManifest([...turns, turn])
  return turn
}

export async function getLocalDailySession(date: string) {
  const sessions = await readSessionsManifest()
  const session = sessions[date]
  if (!session) return null
  const activeSubjectIds = await Promise.all(session.active_subject_ids.map(resolveLocalLogicalSubjectId))
  const completedEntries = await Promise.all(Object.entries(session.completed_subjects).map(async ([subjectId, value]) => [
    await resolveLocalLogicalSubjectId(subjectId),
    value,
  ] as const))
  return {
    ...session,
    active_subject_ids: Array.from(new Set(activeSubjectIds)),
    completed_subjects: Object.fromEntries(completedEntries),
  }
}

export async function saveLocalDailySession(input: {
  date: string
  activeSubjectIds: string[]
  completedSubjects: Record<string, boolean>
  showAllSubjects: boolean
}) {
  const sessions = await readSessionsManifest()
  const current = sessions[input.date]
  const next: DailySessionRecord = {
    id: current?.id ?? nextLocalId(),
    date: input.date,
    active_subject_ids: input.activeSubjectIds,
    completed_subjects: input.completedSubjects,
    show_all_subjects: Boolean(input.showAllSubjects),
  }
  sessions[input.date] = next
  await writeSessionsManifest(sessions)
  return next
}

export async function getLocalSubjectCompletion(date: string, subjectId: string) {
  const manifest = await readSubjectCompletionsManifest()
  const sourceIds = await resolveLocalSubjectSourceIds(subjectId)
  return [subjectId, ...sourceIds].map((id) => manifest[`${date}:${id}`]).find(Boolean) ?? null
}

export async function saveLocalSubjectCompletion(input: { date: string; subjectId: string; panorama: string }) {
  const logicalSubjectId = await resolveLocalLogicalSubjectId(input.subjectId)
  const manifest = await readSubjectCompletionsManifest()
  const key = `${input.date}:${logicalSubjectId}`
  const current = manifest[key]
  const timestamp = nowIso()
  const next: SubjectCompletionRecord = {
    id: current?.id ?? nextLocalId(),
    date: input.date,
    subject_id: logicalSubjectId,
    panorama: input.panorama || "",
    created_at: current?.created_at ?? timestamp,
    updated_at: timestamp,
  }
  manifest[key] = next
  await writeSubjectCompletionsManifest(manifest)
  return next
}

export async function deleteLocalSubjectCompletion(date: string, subjectId: string) {
  const manifest = await readSubjectCompletionsManifest()
  const sourceIds = await resolveLocalSubjectSourceIds(subjectId)
  for (const id of new Set([subjectId, ...sourceIds])) delete manifest[`${date}:${id}`]
  await writeSubjectCompletionsManifest(manifest)
  return { ok: true as const }
}

export async function getLocalSubjectShortcuts(subjectId: string) {
  const shortcuts = await readShortcutsManifest()
  const sourceIds = await resolveLocalSubjectSourceIds(subjectId)
  const records = [subjectId, ...sourceIds].map((id) => shortcuts[id]).filter(Boolean)
  return records.reduce<SubjectShortcuts>((merged, record) => ({
    subjectId,
    eFich: merged.eFich ?? record.eFich,
    figma: merged.figma ?? record.figma,
    nlm: merged.nlm ?? record.nlm,
  }), { subjectId, eFich: null, figma: null, nlm: null })
}

export async function saveLocalSubjectShortcut(input: {
  subjectId: string
  shortcutKey: SubjectShortcutKey
  url: string
}) {
  const storageKey = await resolveLocalSubjectStorageKey(input.subjectId)
  const shortcuts = await readShortcutsManifest()
  const current = shortcuts[storageKey] ?? {
    subjectId: storageKey,
    eFich: null,
    figma: null,
    nlm: null,
  }
  const next = {
    ...current,
    [input.shortcutKey === "e_fich" ? "eFich" : input.shortcutKey === "figma" ? "figma" : "nlm"]:
      input.url.trim() || null,
  } satisfies SubjectShortcuts
  shortcuts[storageKey] = next
  await writeShortcutsManifest(shortcuts)
  return next
}

export async function getLocalCronograma() {
  const manifest = await readCronogramaManifest()
  logWorkspaceDataSource({
    operation: "getLocalCronograma",
    path: [MANIFESTS_DIR, "cronograma.json"].join("/"),
    count: manifest ? 1 : 0,
  })
  if (!manifest) return null
  return {
    fileName: manifest.fileName,
    driveFileId: manifest.driveFileId,
    driveMimeType: manifest.driveMimeType,
    updatedAt: manifest.updatedAt,
  } satisfies CronogramaRecord
}

export async function createLocalCronogramaUploadSession(input: {
  fileName: string
  mimeType: string
}): Promise<WorkspaceUploadSession> {
  const fileName = normalizePdfFileName(input.fileName || "cronograma.pdf")
  const objectKey = getCronogramaRelativePath(fileName)
  return {
    uploadMode: "server",
    objectKey,
    fileName,
    driveFileId: objectKey,
    mimeType: input.mimeType || "application/pdf",
  }
}

export async function completeLocalCronogramaUpload(input: {
  driveFileId: string
  fileName: string
}) {
  const file = await getPersistedWorkspaceFile(input.driveFileId)
  const previous = await readCronogramaManifest()
  const next = {
    version: 1,
    fileName: normalizePdfFileName(input.fileName || file.name),
    driveFileId: file.id,
    driveMimeType: file.mimeType || "application/pdf",
    updatedAt: nowIso(),
  } satisfies Exclude<CronogramaManifest, null>
  await writeCronogramaManifest(next)
  if (previous?.driveFileId && previous.driveFileId !== next.driveFileId) {
    await deleteWorkspaceBlob(previous.driveFileId)
  }
  return {
    fileName: next.fileName,
    driveFileId: next.driveFileId,
    driveMimeType: next.driveMimeType,
    updatedAt: next.updatedAt,
  } satisfies CronogramaRecord
}

export async function uploadWorkspaceBlobFromFormData(formData: FormData) {
  const fileEntry = formData.get("file")
  const objectKey = String(formData.get("objectKey") || "").trim()
  const mimeType = String(formData.get("mimeType") || "").trim() || "application/octet-stream"
  if (!(fileEntry instanceof File)) {
    throw new Error("Missing file")
  }
  if (!isWorkspaceFileId(objectKey)) {
    throw new Error("Invalid objectKey")
  }
  const file = new File([fileEntry], fileEntry.name || "archivo", {
    type: mimeType || fileEntry.type || "application/octet-stream",
  })
  await persistWorkspaceBlob(objectKey, file)
  return {
    driveFileId: objectKey,
    fileName: file.name,
    mimeType: file.type || mimeType,
  }
}

export async function createLocalMaterialUploadSession(input: {
  subjectId: string
  sessionDate: string
  weekNumber?: number
  materialType: SubjectDayMaterialType
  containerId?: number | null
  fileName: string
  mimeType: string
}) {
  const storageKey = await resolveLocalSubjectStorageKey(input.subjectId)
  const parsedDate = parseDateKey(input.sessionDate)
  const weekNumber =
    Number.isInteger(input.weekNumber) && input.weekNumber === getWeekNumberForDate(parsedDate)
      ? input.weekNumber
      : getWeekNumberForDate(parsedDate)
  const fileName = normalizePdfFileName(input.fileName || `${input.materialType}-${input.sessionDate}.pdf`)
  const objectKey = getMaterialRelativePath({
    subjectId: storageKey,
    weekNumber,
    sessionDate: input.sessionDate,
    materialType: input.materialType,
    fileName,
  })
  return {
    uploadMode: "server",
    objectKey,
    fileName,
    driveFileId: objectKey,
    mimeType: input.mimeType || "application/pdf",
    metadata: {
      "subject-id": storageKey,
      "session-date": input.sessionDate,
      "week-number": String(weekNumber),
      "weekday-index": String(getWeekdayIndexFromDateKey(input.sessionDate)),
      "material-type": input.materialType,
      "container-id": Number.isInteger(input.containerId) ? String(input.containerId) : "",
      "original-file-name": fileName,
    },
  } satisfies WorkspaceUploadSession
}

export async function completeLocalMaterialUpload(input: {
  subjectId: string
  sessionDate: string
  weekNumber?: number
  materialType: SubjectDayMaterialType
  containerId?: number | null
  driveFileId: string
  fileName: string
}) {
  const storageKey = await resolveLocalSubjectStorageKey(input.subjectId)
  const parsedDate = parseDateKey(input.sessionDate)
  const weekNumber =
    Number.isInteger(input.weekNumber) && input.weekNumber === getWeekNumberForDate(parsedDate)
      ? input.weekNumber
      : getWeekNumberForDate(parsedDate)
  const weekdayIndex = getWeekdayIndexFromDateKey(input.sessionDate)
  const manifest = await readMaterialManifest(storageKey, weekNumber)
  const existing = manifest.materials.find((candidate) => candidate.drive_file_id === input.driveFileId)
  if (existing) return existing

  const containers = await listLocalSubjectMaterialContainers(input.subjectId)
  const container = Number.isInteger(input.containerId)
    ? containers.find((candidate) => candidate.id === input.containerId)
    : containers.find((candidate) => candidate.kind === input.materialType)
  if (!container) throw new Error("El contenedor no existe.")
  const siblings = manifest.materials.filter(
    (candidate) => candidate.session_date === input.sessionDate && candidate.container_id === container.id
  )
  const timestamp = nowIso()
  const nextMaterial: SubjectDayMaterial = {
    id: nextLocalId(),
    subject_id: storageKey,
    week_number: weekNumber,
    session_date: input.sessionDate,
    weekday_index: weekdayIndex,
    material_type: input.materialType,
    container_id: container.id,
    order_index: siblings.length,
    file_name: normalizePdfFileName(input.fileName),
    drive_file_id: input.driveFileId,
    drive_mime_type: "application/pdf",
    drive_web_view_link: "",
    is_checkup_done: false,
    created_at: timestamp,
    updated_at: timestamp,
  }
  await writeMaterialManifest(storageKey, weekNumber, [...manifest.materials, nextMaterial])
  return nextMaterial
}

const LOCAL_WEEK_MATERIAL_CACHE_MS = 1_500
const localWeekMaterialReads = new Map<string, { promise: Promise<SubjectDayMaterial[]>; expiresAt: number }>()

async function readLocalSubjectWeekMaterials(subjectId: string, weekNumber: number) {
  const cacheKey = `${subjectId}:${weekNumber}`
  const existing = localWeekMaterialReads.get(cacheKey)
  if (existing && existing.expiresAt > Date.now()) return existing.promise
  const pending = (async () => {
    const sourceIds = await resolveLocalSubjectSourceIds(subjectId)
    const [manifests, containers, tagManifest] = await Promise.all([
      Promise.all(sourceIds.map((sourceId) => readMaterialManifest(sourceId, weekNumber))),
      listLocalSubjectMaterialContainers(subjectId),
      readTagManifest(),
    ])
    const tagsWithCounts = withLocalTagUsageCounts(tagManifest)
    const byId = new Map<number, SubjectDayMaterial>()
    const materialsWithStatus = await Promise.all(manifests.flatMap((manifest) => manifest.materials).map(async (material) => ({
      material,
      exists: await workspaceFileExists(material.drive_file_id),
    })))
    for (const { material, exists } of materialsWithStatus) {
      const assigned = new Set(tagManifest.assignments[String(material.id)] ?? [])
      const resolvedContainerId = material.container_id != null &&
        containers.some((container) => container.id === material.container_id)
        ? material.container_id
        : containers.find((container) => container.kind === material.material_type)?.id ?? null
      byId.set(material.id, {
        ...material,
        local_file_status: exists ? material.local_file_status ?? "available" : "missing",
        container_id: resolvedContainerId,
        tags: tagsWithCounts.filter((tag) => assigned.has(tag.id)),
      })
    }
    return sortMaterials(Array.from(byId.values()))
  })()
  const cacheEntry = { promise: pending, expiresAt: Date.now() + LOCAL_WEEK_MATERIAL_CACHE_MS }
  localWeekMaterialReads.set(cacheKey, cacheEntry)
  try {
    const result = await pending
    window.setTimeout(() => {
      if (localWeekMaterialReads.get(cacheKey) === cacheEntry) localWeekMaterialReads.delete(cacheKey)
    }, LOCAL_WEEK_MATERIAL_CACHE_MS)
    return result
  } catch (error) {
    if (localWeekMaterialReads.get(cacheKey) === cacheEntry) localWeekMaterialReads.delete(cacheKey)
    throw error
  }
}

export async function listLocalSubjectDayMaterials(scope: {
  subjectId: string
  weekNumber: number
  sessionDate?: string
  materialType?: SubjectDayMaterialType | null
}) {
  const materials = (await readLocalSubjectWeekMaterials(scope.subjectId, scope.weekNumber)).filter((material) => {
    if (scope.sessionDate && material.session_date !== scope.sessionDate) return false
    if (scope.materialType && material.material_type !== scope.materialType) return false
    return true
  })
  logWorkspaceDataSource({
    operation: "listLocalSubjectDayMaterials",
    path: materialManifestPath(scope.subjectId, scope.weekNumber).join("/"),
    subjectId: scope.subjectId,
    weekNumber: scope.weekNumber,
    sessionDate: scope.sessionDate ?? null,
    materialType: scope.materialType ?? null,
    count: materials.length,
  })
  return materials
}

export async function listLocalPinnedSubjectMaterials(subjectId: string) {
  const pinnedIds = new Set(
    (await listLocalSubjectMaterialContainers(subjectId))
      .filter((container) => container.kind === "custom" && container.isPinned)
      .map((container) => container.id)
  )
  if (pinnedIds.size === 0) return []
  const weekNumbers = await listLocalSubjectWeekNumbersWithContent(subjectId)
  const groups = await Promise.all(
    weekNumbers.map((weekNumber) => listLocalSubjectDayMaterials({ subjectId, weekNumber }))
  )
  return sortMaterials(groups.flat().filter((material) => material.container_id != null && pinnedIds.has(material.container_id)))
}

export async function updateLocalMaterial(
  materialId: number,
  patch: Partial<Pick<SubjectDayMaterial, "is_checkup_done" | "container_id" | "material_type">>
) {
  const material = await findMaterialById(materialId)
  if (!material) return null
  const manifest = await readMaterialManifest(material.subject_id, material.week_number)
  const updatedMaterial: SubjectDayMaterial = {
    ...material,
    is_checkup_done: patch.is_checkup_done ?? material.is_checkup_done,
    container_id: patch.container_id === undefined ? material.container_id : patch.container_id,
    material_type: patch.material_type ?? material.material_type,
    updated_at: nowIso(),
  }
  await writeMaterialManifest(
    material.subject_id,
    material.week_number,
    manifest.materials.map((candidate) => (candidate.id === materialId ? updatedMaterial : candidate))
  )
  return updatedMaterial
}

async function deleteEntryFiles(entries: SubjectDayEntry[]) {
  for (const entry of entries) {
    if (entry.drive_file_id && isWorkspaceFileId(entry.drive_file_id)) {
      await deleteWorkspaceBlob(entry.drive_file_id)
    }
  }
}

export async function deleteLocalMaterial(materialId: number) {
  const material = await findMaterialById(materialId)
  if (!material) return null

  const materialManifest = await readMaterialManifest(material.subject_id, material.week_number)
  await writeMaterialManifest(
    material.subject_id,
    material.week_number,
    materialManifest.materials.filter((candidate) => candidate.id !== materialId)
  )

  const entryManifest = await readEntryManifest(material.subject_id, material.week_number)
  const removedEntries = entryManifest.entries.filter((entry) => entry.subject_day_material_id === materialId)
  if (removedEntries.length > 0) {
    await deleteEntryFiles(removedEntries)
    await writeEntryManifest(
      material.subject_id,
      material.week_number,
      entryManifest.entries.filter((entry) => entry.subject_day_material_id !== materialId)
    )
  }

  if (material.drive_file_id && isWorkspaceFileId(material.drive_file_id)) {
    await deleteWorkspaceBlob(material.drive_file_id)
  }

  const tagManifest = await readTagManifest()
  const assignments = { ...tagManifest.assignments }
  delete assignments[String(materialId)]
  await writeTagManifest({
    ...tagManifest,
    assignments,
    regions: Object.fromEntries(
      Object.entries(tagManifest.regions).filter(([key]) => !key.startsWith(`${materialId}:`))
    ),
  })

  return material
}

export async function createLocalEntryUploadSession(input: {
  subjectId: string
  sessionDate: string
  weekNumber?: number
  materialId?: number | null
  mimeType: string
  subjectName?: string
}) {
  const storageKey = await resolveLocalSubjectStorageKey(input.subjectId)
  const parsedDate = parseDateKey(input.sessionDate)
  const weekNumber =
    Number.isInteger(input.weekNumber) && input.weekNumber === getWeekNumberForDate(parsedDate)
      ? input.weekNumber
      : getWeekNumberForDate(parsedDate)
  const fileName = normalizeAudioFileName(
    `${sanitizePathSegment(input.subjectName || input.subjectId)}-${input.sessionDate}.${input.mimeType.includes("mp4") ? "mp4" : "webm"}`,
    input.mimeType
  )
  const objectKey = getAudioRelativePath({
    subjectId: storageKey,
    weekNumber,
    sessionDate: input.sessionDate,
    fileName,
  })
  return {
    uploadMode: "server",
    objectKey,
    fileName,
    driveFileId: objectKey,
    mimeType: input.mimeType || "audio/webm",
    metadata: {
      "subject-id": storageKey,
      "session-date": input.sessionDate,
      "week-number": String(weekNumber),
      "weekday-index": String(getWeekdayIndexFromDateKey(input.sessionDate)),
      ...(input.materialId != null ? { "material-id": String(input.materialId) } : {}),
      "original-file-name": fileName,
    },
  } satisfies WorkspaceUploadSession
}

export async function createLocalTextEntry(input: {
  subjectId: string
  sessionDate: string
  weekNumber: number
  weekdayIndex: number
  materialId: number | null
  transcriptText: string
  answerText?: string
}) {
  const storageKey = await resolveLocalSubjectStorageKey(input.subjectId)
  const manifest = await readEntryManifest(storageKey, input.weekNumber)
  const orderIndex = manifest.entries.filter(
    (entry) =>
      entry.session_date === input.sessionDate &&
      (entry.subject_day_material_id ?? null) === (input.materialId ?? null)
  ).length
  const timestamp = nowIso()
  const entry: SubjectDayEntry = withEntryDefaults({
    id: nextLocalId(),
    subject_day_material_id: input.materialId,
    subject_id: storageKey,
    week_number: input.weekNumber,
    session_date: input.sessionDate,
    weekday_index: input.weekdayIndex,
    order_index: orderIndex,
    transcript_text: input.transcriptText.trim(),
    drive_file_id: "",
    drive_file_name: "",
    drive_mime_type: "",
    drive_web_view_link: "",
    answer_text: input.answerText?.trim() || null,
    custom_title: null,
    display_title: "",
    practice_state: null,
    pair_id: null,
    pair_role: null,
    is_featured: false,
    external_links: [],
    created_at: timestamp,
    updated_at: timestamp,
  })
  await writeEntryManifest(storageKey, input.weekNumber, [...manifest.entries, entry])
  return entry
}

export async function completeLocalAudioEntryUpload(input: {
  subjectId: string
  sessionDate: string
  weekNumber?: number
  materialId: number | null
  driveFileId: string
  fileName: string
  pairId: string | null
  pairRole: "question" | "answer" | null
}) {
  const storageKey = await resolveLocalSubjectStorageKey(input.subjectId)
  const parsedDate = parseDateKey(input.sessionDate)
  const weekNumber =
    Number.isInteger(input.weekNumber) && input.weekNumber === getWeekNumberForDate(parsedDate)
      ? input.weekNumber
      : getWeekNumberForDate(parsedDate)
  const weekdayIndex = getWeekdayIndexFromDateKey(input.sessionDate)
  const manifest = await readEntryManifest(storageKey, weekNumber)
  const orderIndex = manifest.entries.filter(
    (entry) =>
      entry.session_date === input.sessionDate &&
      (entry.subject_day_material_id ?? null) === (input.materialId ?? null)
  ).length
  const timestamp = nowIso()
  const transcriptText = input.fileName.trim() || "Audio pendiente"
  const entry: SubjectDayEntry = withEntryDefaults({
    id: nextLocalId(),
    subject_day_material_id: input.materialId,
    subject_id: storageKey,
    week_number: weekNumber,
    session_date: input.sessionDate,
    weekday_index: weekdayIndex,
    order_index: orderIndex,
    transcript_text: transcriptText,
    drive_file_id: input.driveFileId,
    drive_file_name: input.fileName.trim() || "audio.webm",
    drive_mime_type: (await getPersistedWorkspaceFile(input.driveFileId)).mimeType || "audio/webm",
    drive_web_view_link: "",
    answer_text: null,
    custom_title: null,
    display_title: "",
    practice_state: null,
    pair_id: input.pairId,
    pair_role: input.pairRole,
    is_featured: false,
    external_links: [],
    created_at: timestamp,
    updated_at: timestamp,
  })
  await writeEntryManifest(storageKey, weekNumber, [...manifest.entries, entry])
  return entry
}

export async function listLocalSubjectDayEntries(scope: {
  subjectId: string
  weekNumber?: number
  sessionDate?: string
  materialId?: number | null
}) {
  const sourceIds = await resolveLocalSubjectSourceIds(scope.subjectId)
  const entries: SubjectDayEntry[] = []
  for (const sourceId of sourceIds) {
    const weekNumbers = typeof scope.weekNumber === "number"
      ? [scope.weekNumber]
      : await listWeekNumbersForManifestKind(ENTRIES_DIR, sourceId)
    for (const weekNumber of weekNumbers) {
      const manifest = await readEntryManifest(sourceId, weekNumber)
      entries.push(
        ...manifest.entries.filter((entry) => {
          if (scope.sessionDate && entry.session_date !== scope.sessionDate) return false
          if (scope.materialId != null && entry.subject_day_material_id !== scope.materialId) return false
          return true
        })
      )
    }
  }

  const sortedEntries = sortEntries(Array.from(new Map(entries.map((entry) => [entry.id, entry])).values())).map(withEntryDefaults)
  logWorkspaceDataSource({
    operation: "listLocalSubjectDayEntries",
    subjectId: scope.subjectId,
    weekNumber: scope.weekNumber ?? null,
    sessionDate: scope.sessionDate ?? null,
    materialId: scope.materialId ?? null,
    count: sortedEntries.length,
  })
  return sortedEntries
}

export async function updateLocalEntry(
  entryId: number,
  body: {
    answerText?: string | null
    transcriptText?: string | null
    customTitle?: string | null
    practiceState?: "erre" | null
    isFeatured?: boolean
    featuredScope?: "entry_scope" | "subject_week"
    pairRole?: "question" | "answer"
    targetMaterialId?: number
  }
) {
  const entry = await findEntryById(entryId)
  if (!entry) return null

  const manifest = await readEntryManifest(entry.subject_id, entry.week_number)
  let nextEntry: SubjectDayEntry = {
    ...entry,
    answer_text: body.answerText !== undefined ? body.answerText : entry.answer_text,
    transcript_text: body.transcriptText !== undefined && body.transcriptText !== null ? body.transcriptText : entry.transcript_text,
    custom_title: body.customTitle !== undefined ? body.customTitle : entry.custom_title,
    practice_state: body.practiceState !== undefined ? body.practiceState : entry.practice_state,
    pair_role: body.pairRole !== undefined ? body.pairRole : entry.pair_role,
    is_featured: body.isFeatured !== undefined ? body.isFeatured : entry.is_featured,
    updated_at: nowIso(),
  }

  if (body.targetMaterialId !== undefined) {
    const targetMaterial = await findMaterialById(body.targetMaterialId)
    if (!targetMaterial) {
      throw new Error("No se encontro el PDF de destino.")
    }
    nextEntry = {
      ...nextEntry,
      subject_day_material_id: targetMaterial.id,
      subject_id: targetMaterial.subject_id,
      week_number: targetMaterial.week_number,
      session_date: targetMaterial.session_date,
      weekday_index: targetMaterial.weekday_index,
    }
  }

  const updateEntries = (entries: SubjectDayEntry[]): SubjectDayEntry[] => {
    let nextEntries = entries.map((candidate) => {
      if (candidate.id === nextEntry.id) return nextEntry
      if (body.pairRole && nextEntry.pair_id && candidate.pair_id === nextEntry.pair_id) {
        return {
          ...candidate,
          pair_role: body.pairRole === "question" ? ("answer" as const) : ("question" as const),
          updated_at: nextEntry.updated_at,
        }
      }
      return candidate
    })

    if (body.isFeatured === true) {
      nextEntries = nextEntries.map((candidate) => {
        const sameScope =
          body.featuredScope === "subject_week"
            ? candidate.subject_id === nextEntry.subject_id && candidate.week_number === nextEntry.week_number
            : candidate.subject_id === nextEntry.subject_id &&
              candidate.week_number === nextEntry.week_number &&
              candidate.session_date === nextEntry.session_date &&
              (candidate.subject_day_material_id ?? null) === (nextEntry.subject_day_material_id ?? null)

        return sameScope ? { ...candidate, is_featured: candidate.id === nextEntry.id } : candidate
      })
    }

    return nextEntries
  }

  if (body.targetMaterialId !== undefined && (nextEntry.subject_id !== entry.subject_id || nextEntry.week_number !== entry.week_number)) {
    await writeEntryManifest(
      entry.subject_id,
      entry.week_number,
      updateEntries(manifest.entries).filter((candidate) => candidate.id !== nextEntry.id)
    )
    const targetManifest = await readEntryManifest(nextEntry.subject_id, nextEntry.week_number)
    await writeEntryManifest(nextEntry.subject_id, nextEntry.week_number, updateEntries([...targetManifest.entries, nextEntry]))
  } else {
    await writeEntryManifest(entry.subject_id, entry.week_number, updateEntries(manifest.entries))
  }

  return withEntryDefaults(nextEntry)
}

export async function deleteLocalEntry(entryId: number) {
  const entry = await findEntryById(entryId)
  if (!entry) return null

  const manifest = await readEntryManifest(entry.subject_id, entry.week_number)
  const entriesToDelete = entry.pair_id
    ? manifest.entries.filter((candidate) => candidate.pair_id === entry.pair_id)
    : manifest.entries.filter((candidate) => candidate.id === entryId)

  await deleteEntryFiles(entriesToDelete)
  await writeEntryManifest(
    entry.subject_id,
    entry.week_number,
    manifest.entries.filter((candidate) => !entriesToDelete.some((target) => target.id === candidate.id))
  )

  return {
    success: true as const,
    id: entryId,
    ids: entriesToDelete.map((candidate) => candidate.id),
  }
}

export async function saveLocalEntryLink(entryId: number, input: { label: string; url: string }) {
  const entry = await findEntryById(entryId)
  if (!entry) return null
  const manifest = await readEntryManifest(entry.subject_id, entry.week_number)
  const nextLink: SubjectDayEntryLink = {
    id: nextLocalId(),
    label: input.label.trim(),
    url: input.url.trim(),
  }
  const updatedEntries = manifest.entries.map((candidate) =>
    candidate.id === entryId
      ? {
          ...candidate,
          external_links: [...(candidate.external_links ?? []), nextLink],
          updated_at: nowIso(),
        }
      : candidate
  )
  await writeEntryManifest(entry.subject_id, entry.week_number, updatedEntries)
  return nextLink
}

export async function getLocalEntryAudioPositionList(materialId: number) {
  const material = await findMaterialById(materialId)
  if (!material) return null
  const manifest = await readEntryManifest(material.subject_id, material.week_number)
  return Promise.all(
    manifest.entries
      .filter((entry) => entry.subject_day_material_id === materialId && (entry as SubjectDayEntry & { audio_position?: unknown }).audio_position)
      .map(async (entry) => ({
        entryId: entry.id,
        materialId,
        pageNum: (entry as SubjectDayEntry & { audio_position: { page_num: number } }).audio_position.page_num,
        xp: (entry as SubjectDayEntry & { audio_position: { xp: number } }).audio_position.xp,
        yp: (entry as SubjectDayEntry & { audio_position: { yp: number } }).audio_position.yp,
        transcriptText: entry.transcript_text,
        title: entry.custom_title?.trim() || entry.drive_file_name || "Audio",
        audioUrl: entry.drive_file_id,
        mimeType: entry.drive_mime_type || "audio/webm",
        pairId: entry.pair_id,
        pairRole: entry.pair_role,
      }))
  )
}

export async function saveLocalEntryAudioPosition(input: {
  materialId: number
  entryId: number
  pageNum: number
  xp: number
  yp: number
}) {
  const entry = await findEntryById(input.entryId)
  if (!entry) return null
  const manifest = await readEntryManifest(entry.subject_id, entry.week_number)
  const updatedEntry = {
    ...entry,
    updated_at: nowIso(),
    audio_position: {
      page_num: input.pageNum,
      xp: input.xp,
      yp: input.yp,
    },
  } as SubjectDayEntry & { audio_position: { page_num: number; xp: number; yp: number } }
  await writeEntryManifest(
    entry.subject_id,
    entry.week_number,
    manifest.entries.map((candidate) => (candidate.id === input.entryId ? updatedEntry : candidate))
  )
  return {
    entryId: updatedEntry.id,
    materialId: input.materialId,
    pageNum: input.pageNum,
    xp: input.xp,
    yp: input.yp,
    transcriptText: updatedEntry.transcript_text,
    title: updatedEntry.custom_title?.trim() || updatedEntry.drive_file_name || "Audio",
    audioUrl: updatedEntry.drive_file_id,
    mimeType: updatedEntry.drive_mime_type || "audio/webm",
    pairId: updatedEntry.pair_id,
    pairRole: updatedEntry.pair_role,
  } satisfies AudioPositionPayload
}

export async function getWorkspaceAudioObjectUrl(entryId: number) {
  const entry = await findEntryById(entryId)
  if (!entry?.drive_file_id || !isWorkspaceFileId(entry.drive_file_id)) return null
  return createObjectUrlForWorkspaceFile(entry.drive_file_id)
}

export async function getWorkspaceMaterialObjectUrl(materialId: number) {
  const material = await findMaterialById(materialId)
  if (!material?.drive_file_id || !isWorkspaceFileId(material.drive_file_id)) return null
  return createObjectUrlForWorkspaceFile(material.drive_file_id)
}

export async function getWorkspaceCronogramaObjectUrl() {
  const cronograma = await getLocalCronograma()
  if (!cronograma?.driveFileId || !isWorkspaceFileId(cronograma.driveFileId)) return null
  return createObjectUrlForWorkspaceFile(cronograma.driveFileId)
}

export async function getLocalMaterialById(materialId: number) {
  return findMaterialById(materialId)
}

export async function getLocalEntryById(entryId: number) {
  return findEntryById(entryId)
}

export async function buildLocalContinuePayload(input: {
  subjectId: string
  weekNumber: number
  sessionDate: string
  mode: "theory" | "practice"
}) {
  const materials = await listLocalSubjectDayMaterials({
    subjectId: input.subjectId,
    weekNumber: input.weekNumber,
    sessionDate: input.mode === "practice" ? input.sessionDate : undefined,
    materialType: input.mode,
  })
  const fixedContainer = (await listLocalSubjectMaterialContainers(input.subjectId))
    .find((container) => container.kind === input.mode)
  const material = materials.find(
    (candidate) =>
      !candidate.is_checkup_done &&
      (candidate.container_id == null || candidate.container_id === fixedContainer?.id)
  ) ?? null
  const entries = await listLocalSubjectDayEntries({
    subjectId: input.subjectId,
    weekNumber: input.weekNumber,
  })
  const previousFeaturedEntry =
    entries.filter((entry) => entry.is_featured).sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0] ?? null
  return {
    material,
    previousFeaturedEntry,
  }
}

export async function syncLocalMaterialPdf(materialId: number, formData: FormData) {
  const material = await findMaterialById(materialId)
  if (!material) return null
  const fileEntry = formData.get("file")
  if (!(fileEntry instanceof File)) {
    throw new Error("Missing file")
  }
  const file = new File([fileEntry], normalizePdfFileName(String(formData.get("fileName") || material.file_name)), {
    type: "application/pdf",
  })
  await persistWorkspaceBlob(material.drive_file_id, file)
  const updatedMaterial = {
    ...material,
    file_name: file.name,
    drive_mime_type: file.type || "application/pdf",
    updated_at: nowIso(),
  }
  const manifest = await readMaterialManifest(material.subject_id, material.week_number)
  await writeMaterialManifest(
    material.subject_id,
    material.week_number,
    manifest.materials.map((candidate) => (candidate.id === materialId ? updatedMaterial : candidate))
  )
  const tagManifest = await readTagManifest()
  await writeTagManifest({
    ...tagManifest,
    regions: Object.fromEntries(
      Object.entries(tagManifest.regions).filter(([key]) => !key.startsWith(`${materialId}:`))
    ),
  })
  return updatedMaterial
}

export async function syncLocalCronogramaPdf(formData: FormData) {
  const fileEntry = formData.get("file")
  if (!(fileEntry instanceof File)) {
    throw new Error("Missing file")
  }
  const current = await getLocalCronograma()
  const driveFileId = current?.driveFileId ?? getCronogramaRelativePath(fileEntry.name || "cronograma.pdf")
  await persistWorkspaceBlob(
    driveFileId,
    new File([fileEntry], normalizePdfFileName(String(formData.get("fileName") || fileEntry.name || current?.fileName || "cronograma.pdf")), {
      type: "application/pdf",
    })
  )
  return completeLocalCronogramaUpload({
    driveFileId,
    fileName: String(formData.get("fileName") || fileEntry.name || current?.fileName || "cronograma.pdf"),
  })
}
