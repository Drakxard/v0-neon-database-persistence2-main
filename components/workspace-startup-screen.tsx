"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"

const WORKSPACE_TABS_STORAGE_KEY = "subject-wheel:workspace-tabs:v1"
const MAIN_WORKSPACE_TAB_ID = "main"

type CachedSubject = {
  id?: string
  name?: string
  color?: string
  tabId?: string
}

type CachedTab = {
  id?: string
  name?: string
  subjectIds?: string[]
}

type CachedWorkspacePreview = {
  activeTabName: string
  tabNames: string[]
  subjects: Array<{ name: string; color: string }>
}

function readCachedWorkspacePreview(): CachedWorkspacePreview | null {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_TABS_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as {
      activeWorkspaceTabId?: string
      workspaceTabs?: Record<string, CachedTab>
      customSubjects?: Record<string, CachedSubject>
      isMainWorkspaceTabVisible?: boolean
    }
    const tabs = parsed.workspaceTabs && typeof parsed.workspaceTabs === "object" ? parsed.workspaceTabs : {}
    const subjects = parsed.customSubjects && typeof parsed.customSubjects === "object" ? parsed.customSubjects : {}
    const activeTabId = typeof parsed.activeWorkspaceTabId === "string" ? parsed.activeWorkspaceTabId : MAIN_WORKSPACE_TAB_ID
    const activeTab = tabs[activeTabId]
    const activeSubjects = activeTabId === MAIN_WORKSPACE_TAB_ID
      ? Object.values(subjects).filter((subject) => subject?.tabId === MAIN_WORKSPACE_TAB_ID)
      : (Array.isArray(activeTab?.subjectIds) ? activeTab.subjectIds : [])
          .map((subjectId) => subjects[subjectId])
          .filter(Boolean)
    const tabNames = [
      ...(parsed.isMainWorkspaceTabVisible === false ? [] : ["Principal"]),
      ...Object.values(tabs).map((tab) => String(tab?.name || "").trim()).filter(Boolean),
    ]
    return {
      activeTabName: activeTabId === MAIN_WORKSPACE_TAB_ID ? "Principal" : String(activeTab?.name || "Última pestaña"),
      tabNames,
      subjects: activeSubjects
        .map((subject) => ({
          name: String(subject?.name || "").replace("\n", " ").trim(),
          color: String(subject?.color || "#0f766e"),
        }))
        .filter((subject) => Boolean(subject.name)),
    }
  } catch {
    return null
  }
}

export function WorkspaceStartupScreen() {
  const pathname = usePathname()
  const [preview, setPreview] = useState<CachedWorkspacePreview | null>(null)

  useEffect(() => {
    if (pathname === "/") setPreview(readCachedWorkspacePreview())
  }, [pathname])

  return (
    <div className="flex min-h-dvh max-h-dvh flex-col overflow-hidden bg-background text-foreground">
      <header className="flex min-h-16 shrink-0 items-center gap-2 overflow-hidden border-b border-border bg-card/95 px-3 py-2 shadow-sm sm:px-5">
        {(preview?.tabNames.length ? preview.tabNames : ["Rueda de Materias"]).slice(0, 6).map((name, index) => (
          <span
            key={`${name}-${index}`}
            className={
              name === preview?.activeTabName
                ? "shrink-0 rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background"
                : "shrink-0 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium"
            }
          >
            {name}
          </span>
        ))}
      </header>
      <main className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-3 py-3">
        <div className="relative flex aspect-square w-[min(82vw,calc(100dvh-9rem),28rem)] items-center justify-center rounded-full border border-border bg-card shadow-sm">
          {preview?.subjects.length ? (
            <div className="grid w-4/5 gap-2 text-center">
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                {preview.activeTabName}
              </p>
              {preview.subjects.slice(0, 8).map((subject) => (
                <div
                  key={subject.name}
                  className="rounded-full px-4 py-2 text-sm font-medium text-white shadow-sm"
                  style={{ backgroundColor: subject.color }}
                >
                  {subject.name}
                </div>
              ))}
            </div>
          ) : (
            <div className="h-4/5 w-4/5 animate-pulse rounded-full bg-muted" />
          )}
        </div>
      </main>
      <footer className="shrink-0 border-t border-border bg-card px-3 py-2 text-center text-xs text-muted-foreground sm:px-4 sm:py-3">
        Recuperando tu última pestaña…
      </footer>
    </div>
  )
}
