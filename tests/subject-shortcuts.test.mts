import assert from "node:assert/strict"
import test from "node:test"

import { getDefaultSubjectShortcuts } from "../lib/subject-shortcuts.ts"

test("los accesos nuevos empiezan con los tres botones predeterminados ordenados", () => {
  const shortcuts = getDefaultSubjectShortcuts("algebra")
  assert.equal(shortcuts.subjectId, "algebra")
  assert.deepEqual(shortcuts.buttons.map((button) => button.label), ["E-Fich", "Figma", "nlm"])
  assert.deepEqual(shortcuts.buttons.map((button) => button.orderIndex), [0, 1, 2])
  assert.ok(shortcuts.buttons.every((button) => button.url === null))
})
