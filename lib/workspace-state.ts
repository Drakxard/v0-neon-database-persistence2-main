import { downloadR2Object, uploadR2Object } from "@/lib/r2"
import { RemoteFileNotFoundError } from "@/lib/remote-file-errors"
import { readLocalState, updateLocalState, type WorkspaceState } from "@/lib/local-state-store"
import { isLocalStorageMode } from "@/lib/storage-mode"

const WORKSPACE_STATE_PREFIX = "manifests/workspace/"
const MAIN_WORKSPACE_TAB_ID = "main"

function createEmptyWorkspaceState(): WorkspaceState {
  return {
    workspaceTabs: {},
    activeWorkspaceTabId: MAIN_WORKSPACE_TAB_ID,
    customSubjects: {},
    isMainWorkspaceTabVisible: true,
  }
}

function sanitizePathSegment(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "local"
}

function workspaceStateKey(email: string) {
  return `${WORKSPACE_STATE_PREFIX}${sanitizePathSegment(email)}.json`
}

function normalizeCustomSubjects(input: Partial<WorkspaceState>["customSubjects"]) {
  if (!input || typeof input !== "object") return {}

  return Object.entries(input).reduce<WorkspaceState["customSubjects"]>((accumulator, [subjectId, subject]) => {
    if (
      !subject ||
      typeof subject.id !== "string" ||
      typeof subject.name !== "string" ||
      typeof subject.color !== "string" ||
      typeof subject.tabId !== "string" ||
      typeof subject.createdAt !== "string"
    ) {
      return accumulator
    }

    const parsedWeekday = Number(subject.targetWeekday)
    const targetWeekday = Number.isInteger(parsedWeekday) && parsedWeekday >= 0 && parsedWeekday <= 4 ? parsedWeekday : 0

    accumulator[subjectId] = {
      id: subject.id,
      name: subject.name,
      color: subject.color,
      tabId: subject.tabId,
      createdAt: subject.createdAt,
      targetWeekday,
    }

    return accumulator
  }, {})
}

function normalizeWorkspaceState(input: Partial<WorkspaceState> | null | undefined): WorkspaceState {
  const isMainWorkspaceTabVisible = input?.isMainWorkspaceTabVisible !== false

  return {
    workspaceTabs: input?.workspaceTabs && typeof input.workspaceTabs === "object" ? input.workspaceTabs : {},
    activeWorkspaceTabId:
      typeof input?.activeWorkspaceTabId === "string" && input.activeWorkspaceTabId.trim()
        ? input.activeWorkspaceTabId.trim()
        : MAIN_WORKSPACE_TAB_ID,
    customSubjects: normalizeCustomSubjects(input?.customSubjects),
    isMainWorkspaceTabVisible,
  }
}

function hasWorkspaceStateContent(state: WorkspaceState) {
  return (
    state.activeWorkspaceTabId !== MAIN_WORKSPACE_TAB_ID ||
    Object.keys(state.workspaceTabs).length > 0 ||
    Object.keys(state.customSubjects).length > 0 ||
    !state.isMainWorkspaceTabVisible
  )
}

async function readRemoteWorkspaceState(email: string) {
  try {
    const payload = await downloadR2Object(workspaceStateKey(email))
    return normalizeWorkspaceState(JSON.parse(payload.buffer.toString("utf8")) as Partial<WorkspaceState>)
  } catch (error) {
    if (error instanceof RemoteFileNotFoundError) {
      return createEmptyWorkspaceState()
    }
    throw error
  }
}

async function writeRemoteWorkspaceState(email: string, state: WorkspaceState) {
  await uploadR2Object({
    objectKey: workspaceStateKey(email),
    mimeType: "application/json",
    body: JSON.stringify(normalizeWorkspaceState(state), null, 2),
    metadata: {
      "workspace-owner": email,
    },
  })
}

async function readLocalWorkspaceState(email: string) {
  const state = await readLocalState()
  return normalizeWorkspaceState(state.workspaceStates[email])
}

async function writeLocalWorkspaceState(email: string, workspaceState: WorkspaceState) {
  return updateLocalState((state) => {
    state.workspaceStates[email] = normalizeWorkspaceState(workspaceState)
    return state.workspaceStates[email]
  })
}

function canUseRemoteWorkspaceState() {
  return Boolean(
    process.env.R2_ENDPOINT?.trim() &&
      process.env.R2_ACCESS_KEY_ID?.trim() &&
      process.env.R2_SECRET_ACCESS_KEY?.trim() &&
      process.env.R2_BUCKET_NAME?.trim()
  )
}

export async function readWorkspaceStateForUser(email: string) {
  const normalizedEmail = email.trim().toLowerCase() || "local@app.local"

  if (isLocalStorageMode()) {
    return createEmptyWorkspaceState()
  }

  if (canUseRemoteWorkspaceState()) {
    try {
      const remoteState = await readRemoteWorkspaceState(normalizedEmail)
      if (hasWorkspaceStateContent(remoteState)) {
        return remoteState
      }

      const localState = await readLocalWorkspaceState(normalizedEmail)
      return hasWorkspaceStateContent(localState) ? localState : remoteState
    } catch (error) {
      console.error("Failed to read remote workspace state; falling back to local state:", error)
    }
  }

  return readLocalWorkspaceState(normalizedEmail)
}

export async function writeWorkspaceStateForUser(email: string, state: WorkspaceState) {
  const normalizedEmail = email.trim().toLowerCase() || "local@app.local"
  const normalizedState = normalizeWorkspaceState(state)

  if (isLocalStorageMode()) {
    return normalizeWorkspaceState(normalizedState)
  }

  if (canUseRemoteWorkspaceState()) {
    try {
      await writeRemoteWorkspaceState(normalizedEmail, normalizedState)
    } catch (error) {
      console.error("Failed to write remote workspace state; falling back to local state:", error)
    }
  }

  return writeLocalWorkspaceState(normalizedEmail, normalizedState)
}
