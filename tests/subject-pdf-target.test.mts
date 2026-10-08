import assert from "node:assert/strict"
import test from "node:test"
import { embeddedStatementRegion, pdfStatementRegion } from "../lib/subject-pdf-target.ts"
import type { PdfSearchResult } from "../lib/subject-pdf-search.ts"

const region = (page: number, y1: number) => ({ page, rotation: 0, x1: 0.1, y1, x2: 0.9, y2: y1 + 0.1 })
const result = {
  title: "TEOREMA 7.1.3 Comportamiento de F(s) conforme s → ∞",
  candidate: { anchorIds: ["statement"], blocks: [
    { id: "example", text: "EJEMPLO 6", region: region(4, 0.1) },
    { id: "statement", text: "TEOREMA 7.1.3", region: region(4, 0.65) },
    { id: "body", text: "Comportamiento de F(s) conforme s → ∞", region: region(4, 0.75) },
  ] }, decision: { blockIds: ["example", "statement", "body"], partialIds: [] },
} as unknown as PdfSearchResult

test("ubica el enunciado por su título antes que el contexto aceptado", () => {
  assert.deepEqual(pdfStatementRegion(result), region(4, 0.65))
  assert.deepEqual(embeddedStatementRegion(result, [1, 4, 7]), { ...region(4, 0.65), page: 2 })
})
test("sin coincidencia de título usa el ancla aceptada y sin coordenadas no inventa una posición", () => {
  assert.deepEqual(pdfStatementRegion({ ...result, title: "Otro título" }), region(4, 0.65))
  assert.equal(embeddedStatementRegion(result, [1, 7]), null)
  const withoutRegions = { ...result, candidate: { ...result.candidate, blocks: result.candidate.blocks.map(block => ({ ...block, region: null })) } }
  assert.equal(pdfStatementRegion(withoutRegions), null)
})
