import { requireOkJson } from "@/lib/client/api"
import { isLocalStorageMode } from "@/lib/storage-mode"
import type { SubjectShortcutKey, SubjectShortcuts } from "@/lib/study-types"

export function getEmptySubjectShortcuts(subjectId = ""): SubjectShortcuts {
  return {
    subjectId,
    eFich: null,
    figma: null,
  }
}

function hasShortcutContent(shortcuts: SubjectShortcuts) {
  return Boolean(shortcuts.eFich?.trim() || shortcuts.figma?.trim())
}

async function fetchSubjectShortcutsFallback(subjectId: string) {
  const searchParams = new URLSearchParams({
    subjectId,
    localWorkspaceBypass: "1",
  })
  const response = await fetch(`/api/subject-shortcuts?${searchParams.toString()}`, {
    cache: "no-store",
  })

  return requireOkJson<SubjectShortcuts>(response, "No se pudieron cargar los accesos directos de la materia.")
}

async function seedLocalSubjectShortcuts(shortcuts: SubjectShortcuts) {
  let nextShortcuts = shortcuts

  if (shortcuts.eFich?.trim()) {
    nextShortcuts = await updateSubjectShortcut({
      subjectId: shortcuts.subjectId,
      shortcutKey: "e_fich",
      url: shortcuts.eFich,
    })
  }

  if (shortcuts.figma?.trim()) {
    nextShortcuts = await updateSubjectShortcut({
      subjectId: shortcuts.subjectId,
      shortcutKey: "figma",
      url: shortcuts.figma,
    })
  }

  return nextShortcuts
}

export async function fetchSubjectShortcuts(subjectId: string) {
  const searchParams = new URLSearchParams({ subjectId })
  const response = await fetch(`/api/subject-shortcuts?${searchParams.toString()}`, {
    cache: "no-store",
  })

  const localShortcuts = await requireOkJson<SubjectShortcuts>(
    response,
    "No se pudieron cargar los accesos directos de la materia."
  )

  if (!isLocalStorageMode() || hasShortcutContent(localShortcuts)) {
    return localShortcuts
  }

  try {
    const fallbackShortcuts = await fetchSubjectShortcutsFallback(subjectId)
    if (!hasShortcutContent(fallbackShortcuts)) {
      return localShortcuts
    }
    return await seedLocalSubjectShortcuts(fallbackShortcuts)
  } catch {
    return localShortcuts
  }
}

export async function updateSubjectShortcut(input: {
  subjectId: string
  shortcutKey: SubjectShortcutKey
  url: string
}) {
  const response = await fetch("/api/subject-shortcuts", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })

  return requireOkJson<SubjectShortcuts>(response, "No se pudo guardar el acceso directo.")
}
