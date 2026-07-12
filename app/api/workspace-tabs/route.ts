import { NextResponse } from "next/server"

import { requireAuthSession } from "@/lib/authz"
import { readLocalState, updateLocalState } from "@/lib/local-state-store"
import { isLocalStorageMode } from "@/lib/storage-mode"
import type { CustomSubjectDefinition, WorkspaceTab } from "@/lib/study-types"
import { readWorkspaceStateForUser, writeWorkspaceStateForUser } from "@/lib/workspace-state"

export const runtime = "nodejs"

function nextLocalId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function nowIso() {
  return new Date().toISOString()
}

function getNextTabName(workspaceTabs: Record<string, WorkspaceTab>) {
  return `Pestaña ${Object.keys(workspaceTabs).length + 1}`
}

function isMissingWorkspaceStateTable(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "42P01")
}

export async function GET() {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    if (isLocalStorageMode()) {
      const state = await readLocalState()
      return NextResponse.json({
        workspaceTabs: state.workspaceTabs,
        activeWorkspaceTabId: state.activeWorkspaceTabId,
        customSubjects: state.customSubjects,
      })
    }

    const state = await readWorkspaceStateForUser(auth.session!.email)
    return NextResponse.json(state)
  } catch (error) {
    console.error("GET /api/workspace-tabs error:", error)
    if (isMissingWorkspaceStateTable(error)) {
      return NextResponse.json(
        { error: "Falta crear la tabla user_workspace_state. Ejecuta scripts/029-create-user-workspace-state.sql en Neon." },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: "No se pudo cargar el workspace." }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const body = await request.json().catch(() => ({}))
    const action = typeof body?.action === "string" ? body.action : ""

    if (action === "create-tab") {
      if (isLocalStorageMode()) {
        const payload = await updateLocalState((state) => {
          const id = nextLocalId("tab")
          const nextTab: WorkspaceTab = {
            id,
            name: getNextTabName(state.workspaceTabs),
            color: "#111827",
            createdAt: nowIso(),
            subjectIds: [],
          }
          state.workspaceTabs[id] = nextTab
          state.activeWorkspaceTabId = id
          return {
            workspaceTabs: state.workspaceTabs,
            activeWorkspaceTabId: state.activeWorkspaceTabId,
            customSubjects: state.customSubjects,
          }
        })

        return NextResponse.json(payload)
      }

      const payload = await writeWorkspaceStateForUser(auth.session!.email, (state) => {
        const id = nextLocalId("tab")
        const nextTab: WorkspaceTab = {
          id,
          name: getNextTabName(state.workspaceTabs),
          color: "#111827",
          createdAt: nowIso(),
          subjectIds: [],
        }
        state.workspaceTabs[id] = nextTab
        state.activeWorkspaceTabId = id
        return {
          workspaceTabs: state.workspaceTabs,
          activeWorkspaceTabId: state.activeWorkspaceTabId,
          customSubjects: state.customSubjects,
        }
      })

      return NextResponse.json(payload.result)
    }

    if (action === "select-tab") {
      const tabId = typeof body?.tabId === "string" ? body.tabId.trim() : ""
      if (!tabId) {
        return NextResponse.json({ error: "Missing tabId" }, { status: 400 })
      }

      if (isLocalStorageMode()) {
        const payload = await updateLocalState((state) => {
          state.activeWorkspaceTabId = tabId
          return {
            workspaceTabs: state.workspaceTabs,
            activeWorkspaceTabId: state.activeWorkspaceTabId,
            customSubjects: state.customSubjects,
          }
        })

        return NextResponse.json(payload)
      }

      const payload = await writeWorkspaceStateForUser(auth.session!.email, (state) => {
        state.activeWorkspaceTabId = tabId
        return {
          workspaceTabs: state.workspaceTabs,
          activeWorkspaceTabId: state.activeWorkspaceTabId,
          customSubjects: state.customSubjects,
        }
      })

      return NextResponse.json(payload.result)
    }

    if (action === "create-subject") {
      const tabId = typeof body?.tabId === "string" ? body.tabId.trim() : ""
      const name = typeof body?.name === "string" ? body.name.trim() : ""
      const color = typeof body?.color === "string" ? body.color.trim() : ""

      if (!tabId || tabId === "main") {
        return NextResponse.json({ error: "Invalid tabId" }, { status: 400 })
      }
      if (!name) {
        return NextResponse.json({ error: "Missing name" }, { status: 400 })
      }
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
        return NextResponse.json({ error: "Invalid color" }, { status: 400 })
      }

      if (isLocalStorageMode()) {
        const payload = await updateLocalState((state) => {
          const tab = state.workspaceTabs[tabId]
          if (!tab) {
            throw new Error("Tab not found.")
          }

          const id = nextLocalId("subject")
          const nextSubject: CustomSubjectDefinition = {
            id,
            name,
            color,
            tabId,
            createdAt: nowIso(),
          }

          state.customSubjects[id] = nextSubject
          state.workspaceTabs[tabId] = {
            ...tab,
            subjectIds: [...tab.subjectIds, id],
          }

          return {
            workspaceTabs: state.workspaceTabs,
            activeWorkspaceTabId: state.activeWorkspaceTabId,
            customSubjects: state.customSubjects,
          }
        })

        return NextResponse.json(payload)
      }

      const payload = await writeWorkspaceStateForUser(auth.session!.email, (state) => {
        const tab = state.workspaceTabs[tabId]
        if (!tab) {
          throw new Error("Tab not found.")
        }

        const id = nextLocalId("subject")
        const nextSubject: CustomSubjectDefinition = {
          id,
          name,
          color,
          tabId,
          createdAt: nowIso(),
        }

        state.customSubjects[id] = nextSubject
        state.workspaceTabs[tabId] = {
          ...tab,
          subjectIds: [...tab.subjectIds, id],
        }

        return {
          workspaceTabs: state.workspaceTabs,
          activeWorkspaceTabId: state.activeWorkspaceTabId,
          customSubjects: state.customSubjects,
        }
      })

      return NextResponse.json(payload.result)
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 })
  } catch (error) {
    console.error("POST /api/workspace-tabs error:", error)
    if (isMissingWorkspaceStateTable(error)) {
      return NextResponse.json(
        { error: "Falta crear la tabla user_workspace_state. Ejecuta scripts/029-create-user-workspace-state.sql en Neon." },
        { status: 503 }
      )
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo actualizar el workspace." },
      { status: 500 }
    )
  }
}
