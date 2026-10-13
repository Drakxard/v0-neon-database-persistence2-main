import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { MockLanguageModelV4, simulateReadableStream } from "ai/test"
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider"
import { explanationStream } from "../lib/server/pdf-explanation-stream.ts"
import { DefaultChatTransport, readUIMessageStream } from "ai"
import { lessonHtml } from "../lib/pdf-explanation-lesson.ts"

function textModel(text: string, reason: "stop" | "length" = "stop") {
  return new MockLanguageModelV4({ doStream: async () => ({ stream: simulateReadableStream({ chunks: [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "text-1" },
    { type: "text-delta", id: "text-1", delta: text },
    { type: "text-end", id: "text-1" },
    { type: "finish", finishReason: { unified: reason, raw: undefined }, usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 20, text: 20, reasoning: undefined },
    } },
  ] as LanguageModelV4StreamPart[] }) }) })
}
async function parts(response: Response) {
  return (await response.text()).split("\n").filter(line => line.startsWith("data: ") && line !== "data: [DONE]").map(line => JSON.parse(line.slice(6)))
}
const html = "<!doctype html><html><head></head><body><svg><circle r='20'/></svg><script>let state=0</script></body></html>"

test("the model receives only the user's request and transcription, without tools or design instructions", async () => {
  const model = textModel(html)
  const question = "Hacé un HTML minimalista con un gráfico"
  await parts(explanationStream(model, question, "Página transcrita"))
  const request = model.doStreamCalls[0]
  assert.deepEqual(request.prompt, [{ role: "user", content: [{ type: "text", text: question + "\n\nPágina transcrita" }], providerOptions: undefined }])
  assert.equal(request.tools, undefined)
  assert.deepEqual(request.toolChoice, { type: "auto" }) // SDK default; no tools are supplied.
  assert.equal(request.abortSignal, undefined)
  assert.equal(request.maxOutputTokens, 1800)
})

test("Azure keeps low reasoning and the output budget while sending the same plain prompt", async () => {
  const model = textModel(html)
  await parts(explanationStream(model, "Mi pedido", "Mi página", { provider: "azure", reasoning: "low", maxOutputTokens: 12_000 }))
  assert.equal(model.doStreamCalls[0].maxOutputTokens, 12_000)
  assert.deepEqual(model.doStreamCalls[0].providerOptions?.openai, { forceReasoning: true, reasoningEffort: "low", reasoningSummary: null })
  assert.equal(model.doStreamCalls[0].tools, undefined)
})

test("the real SDK UI reader delivers the model's own HTML without applying a lesson template", async () => {
  const model = textModel("Aquí está:\n```html\n" + html + "\n```")
  const response = explanationStream(model, "Mi pedido", "Página")
  const transport = new DefaultChatTransport({ fetch: async () => response })
  const stream = await transport.sendMessages({ trigger: "submit-message", chatId: "test", messageId: undefined, messages: [] })
  let delivered = ""
  for await (const message of readUIMessageStream({ stream, terminateOnError: true })) {
    for (const part of message.parts) if (part.type === "data-explanation") delivered = (part.data as { html: string }).html
  }
  assert.ok(delivered.includes("<svg><circle r='20'/></svg>"))
  assert.ok(delivered.includes("<script>let state=0</script>"))
  assert.ok(delivered.includes("connect-src 'none'"))
  assert.equal(model.doStreamCalls.length, 1)
})

test("text and lesson JSON stay in diagnostics and never silently become the old design", async () => {
  for (const text of ["Explicación en texto", JSON.stringify({ title: "Tema", steps: [] }), ""]) {
    const chunks = await parts(explanationStream(textModel(text), "Mi pedido", "Página"))
    assert.ok(chunks.some(part => part.type === "error" && part.errorText.includes("ajustá tu solicitud")))
    assert.ok(!chunks.some(part => part.type === "finish" || part.type === "data-explanation"))
    assert.equal(chunks.find(part => part.type === "data-explanation-debug" && part.data.stage === "validacion-html").data.text, text)
  }
})

test("truncated HTML reports the token limit and preserves the received response", async () => {
  const chunks = await parts(explanationStream(textModel("<html><body>Incompleto", "length"), "Pedido", "Página"))
  assert.ok(chunks.some(part => part.type === "error" && part.errorText.includes("agotó su límite")))
  assert.ok(!chunks.some(part => part.type === "finish" || part.type === "data-explanation"))
})

test("Gateway fallback configuration remains bounded to the models supplied by the selector", async () => {
  const model = textModel(html)
  const fallbackModels = ["inclusionai/ling-3.1-flash-free"]
  await parts(explanationStream(model, "Pedido", "Página", { fallbackModels, maxOutputTokens: 8192 }))
  assert.deepEqual(model.doStreamCalls[0].providerOptions?.gateway, { models: fallbackModels })
  assert.equal(model.doStreamCalls[0].maxOutputTokens, 1800)
})

test("provider failures retain their diagnostic status without exposing credentials", async () => {
  for (const statusCode of [403, 429, 503]) {
    const model = new MockLanguageModelV4({ doStream: async () => ({ stream: simulateReadableStream({ chunks: [
      { type: "stream-start", warnings: [] },
      { type: "error", error: Object.assign(new Error("secret-key"), { statusCode, name: "APICallError", responseBody: "secret-key", generationId: "generation-test" }) },
    ] as LanguageModelV4StreamPart[] }) }) })
    const chunks = await parts(explanationStream(model, "Pedido", "Página", { provider: "azure" }))
    const debug = chunks.find(part => part.type === "data-explanation-debug" && part.data.stage === "error-gateway")
    assert.equal(debug.data.diagnostics.status, statusCode)
    assert.equal(debug.data.diagnostics.generationId, "generation-test")
    assert.ok(!JSON.stringify(chunks).includes("secret-key"))
    assert.ok(!chunks.some(part => part.type === "finish"))
  }
})

test("previously generated lesson documents remain readable, including the reported longer Azure response", () => {
  const lesson = JSON.parse(readFileSync(new URL("./fixtures/pdf-explanation-azure-long-steps.json", import.meta.url), "utf8"))
  const legacyHtml = lessonHtml(lesson)
  const data = JSON.parse(legacyHtml.match(/const lesson=(.*?);let index/)![1])
  assert.deepEqual(data, lesson)
  assert.throws(() => lessonHtml({ title: "Incomplete", steps: [] }))
  assert.ok(!lessonHtml({ ...lesson, title: '</script><script>alert("injected")</script>' }).includes('<script>alert("injected")'))
})
