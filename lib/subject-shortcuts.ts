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
  }))
}

export function normalizeSubjectShortcutButton(button: SubjectShortcutButton): SubjectShortcutButton {
  const sectionUrls = button.sectionUrls && typeof button.sectionUrls === "object"
    ? Object.fromEntries(Object.entries(button.sectionUrls).filter(([key, url]) => key.trim() && typeof url === "string" && url.trim()))
    : {}
  return { ...button, sectionScoped: button.sectionScoped === true, sectionUrls }
}

export function getSubjectShortcutUrl(button: SubjectShortcutButton, sectionKey: string) {
  return button.sectionScoped ? button.sectionUrls[sectionKey] ?? null : button.url
}

export function getDefaultSubjectShortcuts(subjectId = ""): SubjectShortcuts {
  return { subjectId, buttons: getDefaultSubjectShortcutButtons() }
}
