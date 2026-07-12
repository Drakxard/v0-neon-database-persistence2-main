import { neon } from "@neondatabase/serverless"

import type { CustomSubjectDefinition, WorkspaceTab } from "@/lib/study-types"

const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null

type WorkspaceStateRow = {
  email: string
  active_workspace_tab_id: string
  workspace_tabs_json: Record<string, WorkspaceTab> | string | null
  custom_subjects_json: Record<string, CustomSubjectDefinition> | string | null
}

export type WorkspaceState = {
  workspaceTabs: Record<string, WorkspaceTab>
  activeWorkspaceTabId: string
  customSubjects: Record<string, CustomSubjectDefinition>
}

function createEmptyWorkspaceState(): WorkspaceState {
  return {
    workspaceTabs: {},
    activeWorkspaceTabId: "main",
    customSubjects: {},
  }
}

function parseJsonRecord<T>(value: Record<string, T> | string | null | undefined) {
  if (!value) return {} as Record<string, T>
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as Record<string, T> | null
      return parsed && typeof parsed === "object" ? parsed : {}
    } catch {
      return {}
    }
  }

  return value
}

function normalizeWorkspaceState(row: WorkspaceStateRow | null | undefined): WorkspaceState {
  if (!row) return createEmptyWorkspaceState()

  return {
    workspaceTabs: parseJsonRecord(row.workspace_tabs_json),
    activeWorkspaceTabId:
      typeof row.active_workspace_tab_id === "string" && row.active_workspace_tab_id.trim()
        ? row.active_workspace_tab_id.trim()
        : "main",
    customSubjects: parseJsonRecord(row.custom_subjects_json),
  }
}

function requireWorkspaceSql() {
  if (!sql) {
    throw new Error("Missing DATABASE_URL for workspace state.")
  }

  return sql
}

export async function readWorkspaceStateForUser(email: string) {
  const database = requireWorkspaceSql()
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail) return createEmptyWorkspaceState()

  const rows = await database`
    SELECT email, active_workspace_tab_id, workspace_tabs_json, custom_subjects_json
    FROM user_workspace_state
    WHERE email = ${normalizedEmail}
    LIMIT 1
  ` as WorkspaceStateRow[]

  return normalizeWorkspaceState(rows[0] ?? null)
}

export async function writeWorkspaceStateForUser<T>(
  email: string,
  updater: (state: WorkspaceState) => T | Promise<T>
) {
  const database = requireWorkspaceSql()
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail) {
    throw new Error("Missing email for workspace state.")
  }

  const currentState = await readWorkspaceStateForUser(normalizedEmail)
  const nextState: WorkspaceState = {
    workspaceTabs: { ...currentState.workspaceTabs },
    activeWorkspaceTabId: currentState.activeWorkspaceTabId,
    customSubjects: { ...currentState.customSubjects },
  }

  const result = await updater(nextState)

  await database`
    INSERT INTO user_workspace_state (
      email,
      active_workspace_tab_id,
      workspace_tabs_json,
      custom_subjects_json
    )
    VALUES (
      ${normalizedEmail},
      ${nextState.activeWorkspaceTabId},
      ${JSON.stringify(nextState.workspaceTabs)},
      ${JSON.stringify(nextState.customSubjects)}
    )
    ON CONFLICT (email)
    DO UPDATE SET
      active_workspace_tab_id = EXCLUDED.active_workspace_tab_id,
      workspace_tabs_json = EXCLUDED.workspace_tabs_json,
      custom_subjects_json = EXCLUDED.custom_subjects_json,
      updated_at = NOW()
  `

  return { result, state: nextState }
}

export async function listWorkspaceCustomSubjectIdsForUser(email: string) {
  const state = await readWorkspaceStateForUser(email)
  return Object.keys(state.customSubjects)
}
