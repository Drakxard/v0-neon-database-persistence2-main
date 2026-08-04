import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  advanceInscreenStage,
  createInitialInscreenStage,
  firstWeekdayOnOrAfter,
  nextStrictWeekdayAfter,
  normalizeInscreenPageText,
  normalizeInscreenSubjectSegment,
  normalizeInscreenTitle,
} from "../lib/inscreen.ts"

test("normaliza la materia para la ruta InSreen", () => {
  assert.equal(normalizeInscreenSubjectSegment("Álgebra 2"), "algebra2")
  assert.equal(normalizeInscreenSubjectSegment(" Lógica y Computabilidad "), "logicaycomputabilidad")
})

test("alinea la etapa inicial con el día configurado", () => {
  assert.equal(firstWeekdayOnOrAfter("2026-08-10", 0), "2026-08-10")
  assert.equal(firstWeekdayOnOrAfter("2026-08-10", 4), "2026-08-14")
  assert.deepEqual(createInitialInscreenStage("2026-08-10", 0), {
    currentStage: 1,
    nextTransitionDate: "2026-08-17",
  })
  assert.deepEqual(createInitialInscreenStage("2026-08-10", 4), {
    currentStage: 1,
    nextTransitionDate: "2026-08-21",
  })
})

test("avanza todas las semanas vencidas y conserva la próxima frontera", () => {
  assert.deepEqual(advanceInscreenStage({ currentStage: 1, nextTransitionDate: "2026-08-17" }, "2026-08-16"), {
    currentStage: 1,
    nextTransitionDate: "2026-08-17",
  })
  assert.deepEqual(advanceInscreenStage({ currentStage: 1, nextTransitionDate: "2026-08-17" }, "2026-09-01"), {
    currentStage: 4,
    nextTransitionDate: "2026-09-07",
  })
})

test("un cambio de día usa la próxima ocurrencia estrictamente futura", () => {
  assert.equal(nextStrictWeekdayAfter("2026-08-12", 2), "2026-08-19")
  assert.equal(nextStrictWeekdayAfter("2026-08-12", 4), "2026-08-14")
})

test("normaliza texto de página y mantiene el título en una línea", () => {
  assert.equal(normalizeInscreenPageText("  uno\n\t dos  "), "uno dos")
  assert.equal(normalizeInscreenTitle("  Que es\nun grafo? "), "Que es un grafo?")
})

test("cada materia usa su día elegido como inicio relativo de etapa", () => {
  const thursdaySubject = createInitialInscreenStage("2026-08-10", 3)

  assert.deepEqual(thursdaySubject, {
    currentStage: 1,
    nextTransitionDate: "2026-08-20",
  })
  assert.deepEqual(advanceInscreenStage(thursdaySubject, "2026-08-19"), thursdaySubject)
  assert.deepEqual(advanceInscreenStage(thursdaySubject, "2026-08-20"), {
    currentStage: 2,
    nextTransitionDate: "2026-08-27",
  })
})

test("el contrato incluye revisión, deduplicación y subida condicional", () => {
  const server = readFileSync(new URL("../lib/inscreen-server.ts", import.meta.url), "utf8")
  const r2 = readFileSync(new URL("../lib/r2.ts", import.meta.url), "utf8")
  const viewer = readFileSync(new URL("../public/pdfjs/web/viewer-custom.js", import.meta.url), "utf8")

  assert.match(server, /manifests\/inscreen/)
  assert.match(server, /contentRevision/)
  assert.match(server, /captures: Record/)
  assert.match(server, /get\("targetWeekday"\) \?\? ""/)
  assert.match(r2, /IfNoneMatch: params\.ifNoneMatch/)
  assert.match(r2, /IfMatch: params\.ifMatch/)
  assert.match(viewer, /pdfDocument\?\.fingerprints/)
  assert.match(viewer, /INSCREEN_PAGE_READING_MS = 10_000/)
  assert.match(viewer, /Copiar pagina como PNG/)
  assert.match(viewer, /pdfjs-custom-inscreen-pencil/)
  assert.match(viewer, /inscreen:position:/)
  assert.match(viewer, /String\(value \?\? ""\)/)
  assert.match(viewer, /getHighlightEditorSelectedText/)
  assert.match(viewer, /getInscreenDocumentAnnotationEntries/)
  assert.match(viewer, /page\.getAnnotations\(\)/)
  assert.match(viewer, /inscreenConsumedAnnotationIds\.has\(entry\.id\)/)
  assert.match(viewer, /inscreen:highlight-text:/)
  assert.match(viewer, /getCachedInscreenHighlightText/)
  assert.match(viewer, /overlapWidth \/ smallerWidth >= 0\.05/)
  assert.match(viewer, /hasCorruptedPdfText\(body\)/)
  assert.doesNotMatch(viewer, />Lectura enfocada<\/h2>/)
})
