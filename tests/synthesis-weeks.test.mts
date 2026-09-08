import assert from "node:assert/strict"
import test from "node:test"
import { synthesisWeeksFromObjects } from "../lib/synthesis-weeks.ts"

test("widgets list only uploaded synthesis workspaces for their subject, newest week first", () => {
  const prefix = "manifests/inscreen/sintesis/by-subject/"
  const keys = ["algebra/semana-2/synthesis-v2.json", "algebra/semana-11/synthesis-v2.json",
    "algebra/semana-0/synthesis-v2.json", "algebra/semana-3/tree-v1.json",
    "fisica/semana-99/synthesis-v2.json", "algebra/semana-10000/synthesis-v2.json",
    "algebra/semana-1/image.png", "algebra/semana-02/synthesis-v2.json"]
  assert.deepEqual(synthesisWeeksFromObjects("algebra", keys.map(key => ({ key: prefix + key, lastModified: null }))).map(w => w.weekNumber), [11, 2, 0])
  assert.deepEqual(synthesisWeeksFromObjects("empty", []), [])
  assert.throws(() => synthesisWeeksFromObjects("../algebra", []))
})
