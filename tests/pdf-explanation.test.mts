import assert from "node:assert/strict"
import test from "node:test"
import { explanationHtml, explanationInput, explanationPrompt, PDF_EXPLANATION_STYLE } from "../lib/pdf-explanation.ts"

test("explanation includes the student's question, page transcription and animation prompt", () => {
  const input = explanationInput({ question: " ¿Por qué cambia el signo? ", transcription: "La derivada es -2x." })
  const prompt = explanationPrompt(input.question, input.transcription)
  assert.ok(prompt.includes(PDF_EXPLANATION_STYLE))
  assert.ok(prompt.includes("¿Por qué cambia el signo?"))
  assert.ok(prompt.includes("La derivada es -2x."))
  assert.ok(prompt.includes("Vercel AI SDK UI"))
  assert.ok(prompt.includes("renderExplanation"))
  assert.throws(() => explanationInput({ question: "", transcription: "x" }))
  assert.throws(() => explanationInput({ question: "x", transcription: "x".repeat(180001) }))
})

test("explanation requires a complete HTML document and restricts network access", () => {
  const html = explanationHtml('```html\n<html><head></head><body>Ejemplo</body></html>\n```')
  assert.ok(html.startsWith("<html>"))
  assert.ok(html.includes("connect-src 'none'"))
  assert.throws(() => explanationHtml("<div>Respuesta incompleta</div>"))
})
