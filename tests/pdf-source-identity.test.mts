import assert from "node:assert/strict"
import test from "node:test"

import { buildPracticePdfCacheKey } from "../app/practice/viewer/pdf-memory-cache.ts"

test("la cache separa revisiones distintas aunque conserven el materialId", () => {
  const materialId = 178456187466343
  const first = buildPracticePdfCacheKey(materialId, "workspace://practica/a.pdf:2026-07-25T10:00:00Z")
  const replacement = buildPracticePdfCacheKey(materialId, "workspace://practica/a.pdf:2026-07-25T11:00:00Z")

  assert.notEqual(first, replacement)
  assert.equal(
    buildPracticePdfCacheKey(178456188059729, "revision-b"),
    "178456188059729:revision-b"
  )
})
