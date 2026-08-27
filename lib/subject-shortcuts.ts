import type { SubjectShortcutButton, SubjectShortcuts } from "@/lib/study-types"

export const DEFAULT_SUBJECT_SHORTCUTS = ["E-Fich", "Figma", "nlm"]

export function getDefaultSubjectShortcutButtons(): SubjectShortcutButton[] {
  return DEFAULT_SUBJECT_SHORTCUTS.map((label, orderIndex) => ({
    id: `default-${orderIndex}`,
    label,
    url: null,
    orderIndex,
    sectionScoped: false,
    sectionUrls: {},
    integrationRole: label === "nlm" ? "notebooklm" : null,
    activeSectionKey: null,
  }))
}

export function normalizeSubjectShortcutButton(button: SubjectShortcutButton): SubjectShortcutButton {
  const sectionUrls = button.sectionUrls && typeof button.sectionUrls === "object"
    ? Object.fromEntries(Object.entries(button.sectionUrls).filter(([key, url]) => key.trim() && typeof url === "string" && url.trim()))
    : {}
  const integrationRole = button.integrationRole === "notebooklm" || button.label.trim().toLowerCase() === "nlm" ? "notebooklm" : null
  const activeSectionKey = button.sectionScoped
    ? (button.activeSectionKey && sectionUrls[button.activeSectionKey] ? button.activeSectionKey : latestShortcutSectionKey(sectionUrls))
    : null
  return { ...button, sectionScoped: button.sectionScoped === true, sectionUrls, integrationRole, activeSectionKey }
}

function sectionOrder(key: string) {
  const week = /^week:(\d+)$/.exec(key)
  if (week) return { group: 2, value: Number(week[1]) }
  const day = /^day:(\d{4}-\d{2}-\d{2})$/.exec(key)
  if (day) return { group: 1, value: Date.parse(`${day[1]}T00:00:00Z`) }
  return { group: 0, value: 0 }
}

export function latestShortcutSectionKey(sectionUrls: Record<string, string>) {
  return Object.keys(sectionUrls).sort((left, right) => {
    const a = sectionOrder(left)
    const b = sectionOrder(right)
    return b.group - a.group || b.value - a.value || right.localeCompare(left)
  })[0] ?? null
}

export function getNotebookLmShortcutTarget(shortcuts: SubjectShortcuts) {
  const button = shortcuts.buttons.find((candidate) => candidate.integrationRole === "notebooklm")
  if (!button) return null
  if (!button.sectionScoped) return button.url ? { url: button.url, sectionKey: null } : null
  const sectionKey = button.activeSectionKey && button.sectionUrls[button.activeSectionKey]
    ? button.activeSectionKey
    : latestShortcutSectionKey(button.sectionUrls)
  return sectionKey ? { url: button.sectionUrls[sectionKey], sectionKey } : null
}

export function getSubjectShortcutUrl(button: SubjectShortcutButton, sectionKey: string) {
  return button.sectionScoped ? button.sectionUrls[sectionKey] ?? null : button.url
}

export function getDefaultSubjectShortcuts(subjectId = ""): SubjectShortcuts {
  return { subjectId, buttons: getDefaultSubjectShortcutButtons() }
}
