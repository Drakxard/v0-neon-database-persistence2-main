import type { CustomSubjectDefinition, WorkspaceTab } from "@/lib/study-types"
import { SUBJECTS, type SubjectDefinition } from "@/lib/subjects"

export const MAIN_WORKSPACE_TAB_ID = "main"

export type HomeSubjectDefinition = Pick<SubjectDefinition, "id" | "name" | "color"> | CustomSubjectDefinition

export function getMainWorkspaceTab(): WorkspaceTab {
  return {
    id: MAIN_WORKSPACE_TAB_ID,
    name: "Inicio",
    color: "#111827",
    createdAt: new Date(0).toISOString(),
    subjectIds: SUBJECTS.map((subject) => subject.id),
  }
}

export function getWorkspaceTabsList(workspaceTabs: Record<string, WorkspaceTab>) {
  const customTabs = Object.values(workspaceTabs).sort((left, right) => left.createdAt.localeCompare(right.createdAt))
  return [getMainWorkspaceTab(), ...customTabs]
}

export function getAllAvailableSubjects(customSubjects: Record<string, CustomSubjectDefinition>) {
  return [...SUBJECTS, ...Object.values(customSubjects).sort((left, right) => left.createdAt.localeCompare(right.createdAt))]
}

export function getSubjectById(
  subjectId: string,
  customSubjects?: Record<string, CustomSubjectDefinition> | null
): HomeSubjectDefinition | null {
  const builtIn = SUBJECTS.find((subject) => subject.id === subjectId)
  if (builtIn) return builtIn
  return customSubjects?.[subjectId] ?? null
}

export function getSubjectsForTab(params: {
  tabId: string
  baseSubjects?: HomeSubjectDefinition[]
  customSubjects: Record<string, CustomSubjectDefinition>
  workspaceTabs: Record<string, WorkspaceTab>
}) {
  const { tabId, baseSubjects = SUBJECTS, customSubjects, workspaceTabs } = params
  if (tabId === MAIN_WORKSPACE_TAB_ID) {
    return baseSubjects
  }

  const tab = workspaceTabs[tabId]
  if (!tab) return []

  return tab.subjectIds
    .map((subjectId) => customSubjects[subjectId] ?? null)
    .filter((subject): subject is CustomSubjectDefinition => subject !== null)
}
