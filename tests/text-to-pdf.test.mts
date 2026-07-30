import assert from "node:assert/strict"
import test from "node:test"

import {
  normalizeDraggedText,
  normalizePdfFileName,
  wrapTextForPdf,
} from "../lib/client/text-to-pdf.ts"

test("normaliza saltos y tabs sin perder acentos ni lineas vacias", () => {
  const normalized = normalizeDraggedText("canción\r\n\tcout << \"hola\";\r\n\r\nfin")
  assert.equal(normalized, "canción\n    cout << \"hola\";\n\nfin")
})

test("ajusta lineas largas y conserva lineas vacias", () => {
  assert.deepEqual(
    wrapTextForPdf("123456789\n\nabc", 4),
    ["1234", "5678", "9", "", "abc"]
  )
})

test("agrega la extension y limpia caracteres invalidos del nombre", () => {
  assert.equal(normalizePdfFileName("  Ejemplo: lista?.pdf  "), "Ejemplo- lista.pdf")
  assert.throws(() => normalizePdfFileName(" ... "), /nombre válido/)
})
