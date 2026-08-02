import assert from "node:assert/strict"
import test from "node:test"

import {
  buildPdfTranslationPrompt,
  DEFAULT_PDF_TRANSLATION_PROMPT,
  PDF_TRANSLATION_MODEL,
} from "../lib/pdf-translation.ts"

test("el prompt PDF usa el modelo fijo y reemplaza todas las apariciones de texto", () => {
  assert.equal(PDF_TRANSLATION_MODEL, "llama-3.3-70b-versatile")
  assert.equal(
    buildPdfTranslationPrompt("Hello world", DEFAULT_PDF_TRANSLATION_PROMPT),
    "Traduce a español el texto, sin agregar de más: Hello world"
  )
  assert.equal(buildPdfTranslationPrompt("x", "{texto} / {texto}"), "x / x")
})

test("el prompt PDF exige texto y el marcador editable", () => {
  assert.throws(() => buildPdfTranslationPrompt("", DEFAULT_PDF_TRANSLATION_PROMPT), /TRANSLATION_TEXT_REQUIRED/)
  assert.throws(() => buildPdfTranslationPrompt("Hello", "Traduce esto"), /TRANSLATION_TOKEN_REQUIRED/)
})
