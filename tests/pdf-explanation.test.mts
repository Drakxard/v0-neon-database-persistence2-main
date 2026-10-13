import assert from "node:assert/strict"
import test from "node:test"
import { explanationHtml, explanationInput, explanationPrompt } from "../lib/pdf-explanation.ts"
import { explanationFailure } from "../lib/pdf-explanation-errors.ts"

test("optional region is accepted while page transcription remains required", () => {
  const image = "data:image/png;base64,aGVsbG8="
  assert.equal(explanationInput({ question: "", transcription: "Texto", image }).image, image)
  assert.equal(explanationInput({ question: "", transcription: "Texto" }).image, undefined)
  for (const invalid of [null, "https://example.com/image.png", "data:image/svg+xml;base64,aGVsbG8=", "data:image/png;base64,!"]) {
    assert.throws(() => explanationInput({ question: "", transcription: "Texto", image: invalid }))
  }
  assert.throws(() => explanationInput({ question: "", transcription: "", image }))
})

test("explanation sends exactly the student's request and page transcription", () => {
  const input = explanationInput({ question: " ¿Por qué cambia el signo? ", transcription: "La derivada es -2x." })
  const prompt = explanationPrompt(input.question, input.transcription)
  assert.equal(prompt, "¿Por qué cambia el signo?\n\nLa derivada es -2x.")
  assert.equal(explanationInput({ question: "  ", transcription: "x" }).question, "Explicalo")
  assert.throws(() => explanationInput({ transcription: "x" }))
  assert.throws(() => explanationInput({ question: "x", transcription: "x".repeat(180001) }))
})

test("Gateway errors identify credentials, permissions and rate limits without returning secret error details", () => {
  assert.match(explanationFailure({ statusCode: 401, message: "secret-key" }).message, /401/)
  assert.match(explanationFailure({ cause: { statusCode: 403 } }).message, /permisos/)
  assert.match(explanationFailure({ lastError: { statusCode: 429 } }).message, /429/)
  assert.match(explanationFailure({ name: "TimeoutError" }).message, /transcripción ya está guardada/)
  assert.ok(!JSON.stringify(explanationFailure({ statusCode: 401, message: "secret-key" })).includes("secret-key"))
})

test("explanation requires a complete HTML document and restricts network access", () => {
  const html = explanationHtml('```html\n<html><head></head><body>Ejemplo</body></html>\n```')
  assert.ok(html.startsWith("<html>"))
  assert.ok(html.includes("connect-src 'none'"))
  assert.throws(() => explanationHtml("<div>Respuesta incompleta</div>"))
})
