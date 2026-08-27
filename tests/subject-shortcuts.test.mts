import assert from "node:assert/strict"
import test from "node:test"

import { getDefaultSubjectShortcuts, getNotebookLmShortcutTarget, getSubjectShortcutUrl, normalizeSubjectShortcutButton } from "../lib/subject-shortcuts.ts"

test("los accesos nuevos empiezan con los tres botones predeterminados ordenados", () => {
  const shortcuts = getDefaultSubjectShortcuts("algebra")
  assert.equal(shortcuts.subjectId, "algebra")
  assert.deepEqual(shortcuts.buttons.map((button) => button.label), ["E-Fich", "Figma", "nlm"])
  assert.deepEqual(shortcuts.buttons.map((button) => button.orderIndex), [0, 1, 2])
  assert.ok(shortcuts.buttons.every((button) => button.url === null))
  assert.ok(shortcuts.buttons.every((button) => !button.sectionScoped))
  assert.ok(shortcuts.buttons.every((button) => Object.keys(button.sectionUrls).length === 0))
  assert.equal(shortcuts.buttons.find((button) => button.label === "nlm")?.integrationRole, "notebooklm")
})

test("NotebookLM conserva la ultima seccion activa y migra enlaces anteriores por orden cronologico", () => {
  const migrated = normalizeSubjectShortcutButton({
    id: "legacy",
    label: "nlm",
    url: null,
    orderIndex: 2,
    sectionScoped: true,
    sectionUrls: {
      "week:2": "https://example.com/s2",
      "week:10": "https://example.com/s10",
      "week:3": "https://example.com/s3",
    },
  } as never)
  assert.equal(migrated.activeSectionKey, "week:10")
  assert.deepEqual(getNotebookLmShortcutTarget({ subjectId: "eo", buttons: [migrated] }), {
    url: "https://example.com/s10",
    sectionKey: "week:10",
  })

  const explicitlyActive = normalizeSubjectShortcutButton({
    ...migrated,
    activeSectionKey: "week:3",
  })
  assert.equal(getNotebookLmShortcutTarget({ subjectId: "eo", buttons: [explicitlyActive] })?.url, "https://example.com/s3")
})

test("un acceso global mantiene compatibilidad y uno por seccion resuelve solo el contexto actual", () => {
  const global = normalizeSubjectShortcutButton({
    id: "nlm",
    label: "nlm",
    url: "https://example.com/general",
    orderIndex: 2,
  } as never)
  assert.equal(getSubjectShortcutUrl(global, "week:3"), "https://example.com/general")

  const scoped = {
    ...global,
    sectionScoped: true,
    sectionUrls: {
      "day:2026-08-19": "https://example.com/miercoles",
      "week:22": "https://example.com/semana-22",
    },
  }
  assert.equal(getSubjectShortcutUrl(scoped, "day:2026-08-19"), "https://example.com/miercoles")
  assert.equal(getSubjectShortcutUrl(scoped, "week:22"), "https://example.com/semana-22")
  assert.equal(getSubjectShortcutUrl(scoped, "week:23"), null)
})
