import assert from "node:assert/strict"
import test from "node:test"

import { getDefaultSubjectShortcuts, getSubjectShortcutUrl, normalizeSubjectShortcutButton } from "../lib/subject-shortcuts.ts"

test("los accesos nuevos empiezan con los tres botones predeterminados ordenados", () => {
  const shortcuts = getDefaultSubjectShortcuts("algebra")
  assert.equal(shortcuts.subjectId, "algebra")
  assert.deepEqual(shortcuts.buttons.map((button) => button.label), ["E-Fich", "Figma", "nlm"])
  assert.deepEqual(shortcuts.buttons.map((button) => button.orderIndex), [0, 1, 2])
  assert.ok(shortcuts.buttons.every((button) => button.url === null))
  assert.ok(shortcuts.buttons.every((button) => !button.sectionScoped))
  assert.ok(shortcuts.buttons.every((button) => Object.keys(button.sectionUrls).length === 0))
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
