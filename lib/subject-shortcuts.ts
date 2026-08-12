import type { SubjectShortcutButton, SubjectShortcuts } from "@/lib/study-types"

export const DEFAULT_SUBJECT_SHORTCUTS = ["E-Fich", "Figma", "nlm"]

export function getDefaultSubjectShortcutButtons(): SubjectShortcutButton[] {
  return DEFAULT_SUBJECT_SHORTCUTS.map((label, orderIndex) => ({
    id: `default-${orderIndex}`,
    label,
    url: null,
    orderIndex,
  }))
}

export function getDefaultSubjectShortcuts(subjectId = ""): SubjectShortcuts {
  return { subjectId, buttons: getDefaultSubjectShortcutButtons() }
}
