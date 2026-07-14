import { promises as fs } from "node:fs"
import path from "node:path"

type LocalStateShape = {
  aiPrompt: string
  workspaceStates: Record<string, WorkspaceState>
  dailySessions: Record<string, {
    id: number
    date: string
    active_subject_ids: string[]
    completed_subjects: Record<string, boolean>
    show_all_subjects: boolean
  }>
  subjectCompletions: Record<string, {
    id: number
    date: string
    subject_id: string
    panorama: string
    created_at: string
    updated_at: string
  }>
  subjectShortcuts: Record<string, {
    subjectId: string
    eFich: string | null
    figma: string | null
  }>
  subjectOpenCounts: Record<string, {
    id: number
    week_number: number
    subject_id: string
    count: number
    last_open_hour_key: string | null
    created_at: string
    updated_at: string
  }>
}

export type WorkspaceTabState = {
  id: string
  name: string
  color: string
  createdAt: string
  subjectIds: string[]
}

export type CustomSubjectState = {
  id: string
  name: string
  color: string
  tabId: string
  createdAt: string
  targetWeekday: number
}

export type WorkspaceState = {
  workspaceTabs: Record<string, WorkspaceTabState>
  activeWorkspaceTabId: string
  customSubjects: Record<string, CustomSubjectState>
  isMainWorkspaceTabVisible: boolean
}

const LOCAL_STATE_DIRECTORY = path.join(process.cwd(), ".local-data")
const LOCAL_STATE_FILE = path.join(LOCAL_STATE_DIRECTORY, "app-state.json")

function createEmptyState(): LocalStateShape {
  return {
    aiPrompt: "",
    workspaceStates: {},
    dailySessions: {},
    subjectCompletions: {},
    subjectShortcuts: {},
    subjectOpenCounts: {},
  }
}

async function ensureLocalStateFile() {
  await fs.mkdir(LOCAL_STATE_DIRECTORY, { recursive: true })
  try {
    await fs.access(LOCAL_STATE_FILE)
  } catch {
    await fs.writeFile(LOCAL_STATE_FILE, JSON.stringify(createEmptyState(), null, 2), "utf8")
  }
}

export async function readLocalState() {
  await ensureLocalStateFile()
  const raw = await fs.readFile(LOCAL_STATE_FILE, "utf8")
  try {
    const parsed = JSON.parse(raw) as Partial<LocalStateShape>
    return {
      ...createEmptyState(),
      ...parsed,
      workspaceStates: parsed.workspaceStates ?? {},
      dailySessions: parsed.dailySessions ?? {},
      subjectCompletions: parsed.subjectCompletions ?? {},
      subjectShortcuts: parsed.subjectShortcuts ?? {},
      subjectOpenCounts: parsed.subjectOpenCounts ?? {},
      aiPrompt: typeof parsed.aiPrompt === "string" ? parsed.aiPrompt : "",
    } satisfies LocalStateShape
  } catch {
    return createEmptyState()
  }
}

export async function writeLocalState(nextState: LocalStateShape) {
  await ensureLocalStateFile()
  await fs.writeFile(LOCAL_STATE_FILE, JSON.stringify(nextState, null, 2), "utf8")
}

export async function updateLocalState<T>(updater: (state: LocalStateShape) => T | Promise<T>) {
  const state = await readLocalState()
  const result = await updater(state)
  await writeLocalState(state)
  return result
}
