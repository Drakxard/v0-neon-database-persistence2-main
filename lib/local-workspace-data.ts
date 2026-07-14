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
  SubjectMaterialSynthesisRecord,
  SubjectShortcutKey,
  SubjectShortcuts,
} from "@/lib/study-types"
import { loadWorkspaceHandle, queryWorkspacePermission } from "@/lib/local-workspace-client"
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
const ROOT_SUBDIRECTORIES = [CRONOGRAMA_DIR, THEORY_DIR, PRACTICE_DIR, AUDIO_DIR, MANIFESTS_DIR] as const
const WORKSPACE_STATE_MANIFEST = [MANIFESTS_DIR, "workspace-state.json"]
const MAIN_WORKSPACE_TAB_ID = "main"

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
  const handle = await loadWorkspaceHandle()
  if (!handle) {
    throw new Error("No hay una carpeta local seleccionada.")
  }

  const permission = await queryWorkspacePermission(handle, "readwrite")
  if (permission !== "granted") {
    throw new Error("No hay permiso de lectura/escritura para la carpeta local.")
  }

  for (const directoryName of ROOT_SUBDIRECTORIES) {
    await handle.getDirectoryHandle(directoryName, { create: true })
  }

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

async function writeJsonFile(pathSegments: string[], value: unknown) {
  const rootHandle = await ensureWorkspaceRootHandle()
  const fileHandle = await getFileHandleBySegments(rootHandle, pathSegments, true)
  const writable = await fileHandle.createWritable()
  await writable.write(JSON.stringify(value, null, 2))
  await writable.close()
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
  const targetWeekday = Number.isInteger(parsedWeekday) && parsedWeekday >= 0 && parsedWeekday <= 4 ? parsedWeekday : 0

  return {
    id: input.id,
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
    customSubjects: normalizeLocalCustomSubjects(input?.customSubjects),
    isMainWorkspaceTabVisible,
  }
}

export async function readLocalWorkspaceTabsState(): Promise<LocalWorkspaceTabsReadResult> {
  const exists = await jsonFileExists(WORKSPACE_STATE_MANIFEST)
  if (!exists) {
    logWorkspaceDataSource({
      operation: "readLocalWorkspaceTabsState",
      path: WORKSPACE_STATE_MANIFEST.join("/"),
      exists: false,
      count: 0,
    })
    return {
      state: createEmptyWorkspaceTabsState(),
      exists: false,
    }
  }

  const state = await readJsonFile<Partial<LocalWorkspaceTabsState> | null>(WORKSPACE_STATE_MANIFEST, null)
  const normalizedState = normalizeLocalWorkspaceTabsState(state)
  logWorkspaceDataSource({
    operation: "readLocalWorkspaceTabsState",
    path: WORKSPACE_STATE_MANIFEST.join("/"),
    exists: true,
    workspaceTabs: Object.keys(normalizedState.workspaceTabs).length,
    customSubjects: Object.keys(normalizedState.customSubjects).length,
  })
  return {
    state: normalizedState,
    exists: true,
  }
}

export async function saveLocalWorkspaceTabsState(state: Partial<LocalWorkspaceTabsState>) {
  const normalizedState = normalizeLocalWorkspaceTabsState(state)
  await writeJsonFile(WORKSPACE_STATE_MANIFEST, normalizedState)
  logWorkspaceDataSource({
    operation: "saveLocalWorkspaceTabsState",
    path: WORKSPACE_STATE_MANIFEST.join("/"),
    workspaceTabs: Object.keys(normalizedState.workspaceTabs).length,
    customSubjects: Object.keys(normalizedState.customSubjects).length,
  })
  return normalizedState
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
  const items = Array.isArray(payload) ? normalizeSynthesisProgressItems(payload) : []
  if (Array.isArray(payload) && items.length === 0) {
    await deleteJsonFile(synthesisProgressPath(subjectId, weekNumber))
  }
  return items
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
      const cleanup = await cleanupLocalSubjectWeekIfEmpty(subjectId, weekNumber)
      if (!cleanup.hasContent) {
        continue
      }

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

    const weekNumber = Number.parseInt(match[1], 10)
    const cleanup = await cleanupLocalSubjectWeekIfEmpty(subjectId, weekNumber)
    if (!cleanup.hasContent) {
      continue
    }

    weekNumbers.push(weekNumber)
  }

  return weekNumbers
}

async function findMaterialById(materialId: number): Promise<SubjectDayMaterial | null> {
  for (const subject of SUBJECTS) {
    const weekNumbers = await listWeekNumbersForManifestKind(MATERIALS_DIR, subject.id)
    for (const weekNumber of weekNumbers) {
      const manifest = await readMaterialManifest(subject.id, weekNumber)
      const material = manifest.materials.find((candidate) => candidate.id === materialId)
      if (material) return material
    }
  }
  return null
}

async function findEntryById(entryId: number): Promise<SubjectDayEntry | null> {
  for (const subject of SUBJECTS) {
    const weekNumbers = await listWeekNumbersForManifestKind(ENTRIES_DIR, subject.id)
    for (const weekNumber of weekNumbers) {
      const manifest = await readEntryManifest(subject.id, weekNumber)
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
    sanitizePathSegment(params.subjectId),
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
    sanitizePathSegment(params.subjectId),
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
  return readSynthesisProgressManifest(subjectId, weekNumber)
}

export async function saveLocalSynthesisProgress(
  subjectId: string,
  weekNumber: number,
  items: Array<Omit<SubjectMaterialSynthesisRecord, "updatedAt"> & { updatedAt?: string | null }>
) {
  const normalizedItems = coerceSynthesisProgressItems(items)
  await writeSynthesisProgressManifest(subjectId, weekNumber, normalizedItems)
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
  const [materialWeeks, entryWeeks, synthesisWeeks] = await Promise.all([
    listWeekNumbersForManifestKind(MATERIALS_DIR, subjectId),
    listWeekNumbersForManifestKind(ENTRIES_DIR, subjectId),
    listSynthesisWeekNumbersForSubject(subjectId),
  ])

  return Array.from(new Set([...materialWeeks, ...entryWeeks, ...synthesisWeeks])).sort((left, right) => right - left)
}

export async function listLocalWeekNumbersWithContent(subjectIds: string[]) {
  const weeksBySubject = await Promise.all(subjectIds.map((subjectId) => listLocalSubjectWeekNumbersWithContent(subjectId)))
  return Array.from(new Set(weeksBySubject.flat())).sort((left, right) => right - left)
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
  return sessions[date] ?? null
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
  return manifest[`${date}:${subjectId}`] ?? null
}

export async function saveLocalSubjectCompletion(input: { date: string; subjectId: string; panorama: string }) {
  const manifest = await readSubjectCompletionsManifest()
  const key = `${input.date}:${input.subjectId}`
  const current = manifest[key]
  const timestamp = nowIso()
  const next: SubjectCompletionRecord = {
    id: current?.id ?? nextLocalId(),
    date: input.date,
    subject_id: input.subjectId,
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
  delete manifest[`${date}:${subjectId}`]
  await writeSubjectCompletionsManifest(manifest)
  return { ok: true as const }
}

export async function getLocalSubjectShortcuts(subjectId: string) {
  const shortcuts = await readShortcutsManifest()
  return shortcuts[subjectId] ?? {
    subjectId,
    eFich: null,
    figma: null,
  }
}

export async function saveLocalSubjectShortcut(input: {
  subjectId: string
  shortcutKey: SubjectShortcutKey
  url: string
}) {
  const shortcuts = await readShortcutsManifest()
  const current = shortcuts[input.subjectId] ?? {
    subjectId: input.subjectId,
    eFich: null,
    figma: null,
  }
  const next = {
    ...current,
    [input.shortcutKey === "e_fich" ? "eFich" : "figma"]: input.url.trim() || null,
  } satisfies SubjectShortcuts
  shortcuts[input.subjectId] = next
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
  fileName: string
  mimeType: string
}) {
  const parsedDate = parseDateKey(input.sessionDate)
  const weekNumber =
    Number.isInteger(input.weekNumber) && input.weekNumber === getWeekNumberForDate(parsedDate)
      ? input.weekNumber
      : getWeekNumberForDate(parsedDate)
  const fileName = normalizePdfFileName(input.fileName || `${input.materialType}-${input.sessionDate}.pdf`)
  const objectKey = getMaterialRelativePath({
    subjectId: input.subjectId,
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
      "subject-id": input.subjectId,
      "session-date": input.sessionDate,
      "week-number": String(weekNumber),
      "weekday-index": String(getWeekdayIndexFromDateKey(input.sessionDate)),
      "material-type": input.materialType,
      "original-file-name": fileName,
    },
  } satisfies WorkspaceUploadSession
}

export async function completeLocalMaterialUpload(input: {
  subjectId: string
  sessionDate: string
  weekNumber?: number
  materialType: SubjectDayMaterialType
  driveFileId: string
  fileName: string
}) {
  const parsedDate = parseDateKey(input.sessionDate)
  const weekNumber =
    Number.isInteger(input.weekNumber) && input.weekNumber === getWeekNumberForDate(parsedDate)
      ? input.weekNumber
      : getWeekNumberForDate(parsedDate)
  const weekdayIndex = getWeekdayIndexFromDateKey(input.sessionDate)
  const manifest = await readMaterialManifest(input.subjectId, weekNumber)
  const existing = manifest.materials.find((candidate) => candidate.drive_file_id === input.driveFileId)
  if (existing) return existing

  const siblings = manifest.materials.filter(
    (candidate) => candidate.session_date === input.sessionDate && candidate.material_type === input.materialType
  )
  const timestamp = nowIso()
  const nextMaterial: SubjectDayMaterial = {
    id: nextLocalId(),
    subject_id: input.subjectId,
    week_number: weekNumber,
    session_date: input.sessionDate,
    weekday_index: weekdayIndex,
    material_type: input.materialType,
    order_index: siblings.length,
    file_name: normalizePdfFileName(input.fileName),
    drive_file_id: input.driveFileId,
    drive_mime_type: "application/pdf",
    drive_web_view_link: "",
    is_checkup_done: false,
    created_at: timestamp,
    updated_at: timestamp,
  }
  await writeMaterialManifest(input.subjectId, weekNumber, [...manifest.materials, nextMaterial])
  return nextMaterial
}

export async function listLocalSubjectDayMaterials(scope: {
  subjectId: string
  weekNumber: number
  sessionDate?: string
  materialType?: SubjectDayMaterialType | null
}) {
  const manifest = await readMaterialManifest(scope.subjectId, scope.weekNumber)
  const materials = manifest.materials.filter((material) => {
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

export async function updateLocalMaterial(
  materialId: number,
  patch: Partial<Pick<SubjectDayMaterial, "is_checkup_done">>
) {
  const material = await findMaterialById(materialId)
  if (!material) return null
  const manifest = await readMaterialManifest(material.subject_id, material.week_number)
  const updatedMaterial: SubjectDayMaterial = {
    ...material,
    is_checkup_done: patch.is_checkup_done ?? material.is_checkup_done,
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
    subjectId: input.subjectId,
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
      "subject-id": input.subjectId,
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
  const manifest = await readEntryManifest(input.subjectId, input.weekNumber)
  const orderIndex = manifest.entries.filter(
    (entry) =>
      entry.session_date === input.sessionDate &&
      (entry.subject_day_material_id ?? null) === (input.materialId ?? null)
  ).length
  const timestamp = nowIso()
  const entry: SubjectDayEntry = withEntryDefaults({
    id: nextLocalId(),
    subject_day_material_id: input.materialId,
    subject_id: input.subjectId,
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
  await writeEntryManifest(input.subjectId, input.weekNumber, [...manifest.entries, entry])
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
  const parsedDate = parseDateKey(input.sessionDate)
  const weekNumber =
    Number.isInteger(input.weekNumber) && input.weekNumber === getWeekNumberForDate(parsedDate)
      ? input.weekNumber
      : getWeekNumberForDate(parsedDate)
  const weekdayIndex = getWeekdayIndexFromDateKey(input.sessionDate)
  const manifest = await readEntryManifest(input.subjectId, weekNumber)
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
    subject_id: input.subjectId,
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
  await writeEntryManifest(input.subjectId, weekNumber, [...manifest.entries, entry])
  return entry
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
      : await listWeekNumbersForManifestKind(ENTRIES_DIR, scope.subjectId)

  const entries: SubjectDayEntry[] = []
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

  const sortedEntries = sortEntries(entries).map(withEntryDefaults)
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

  const updateEntries = (entries: SubjectDayEntry[]) => {
    let nextEntries = entries.map((candidate) => {
      if (candidate.id === nextEntry.id) return nextEntry
      if (body.pairRole && nextEntry.pair_id && candidate.pair_id === nextEntry.pair_id) {
        return {
          ...candidate,
          pair_role: body.pairRole === "question" ? "answer" : "question",
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
  const material = materials.find((candidate) => !candidate.is_checkup_done) ?? null
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
