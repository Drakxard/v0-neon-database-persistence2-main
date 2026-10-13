import assert from "node:assert/strict"
import test from "node:test"
import { MockLanguageModelV4, simulateReadableStream } from "ai/test"
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider"
import { explanationStream } from "../lib/server/pdf-explanation-stream.ts"

function modelFor(html: string) {
  const chunks: LanguageModelV4StreamPart[] = [
    { type: "stream-start", warnings: [] },
    { type: "tool-call", toolCallId: "render-1", toolName: "renderExplanation", input: JSON.stringify({ html }) },
    { type: "finish", finishReason: { unified: "tool-calls", raw: undefined }, usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 20, text: 20, reasoning: undefined },
    } },
  ]
  return new MockLanguageModelV4({ doStream: async () => ({ stream: simulateReadableStream({ chunks }) }) })
}

async function parts(response: Response) {
  return (await response.text()).split("\n").filter(line => line.startsWith("data: ") && line !== "data: [DONE]").map(line => JSON.parse(line.slice(6)))
}

test("request instructs the Gateway model to return UI through renderExplanation and streams validated HTML", async () => {
  const model = modelFor("<html><head></head><body>Pasos</body></html>")
  const response = explanationStream(model, "¿Por qué cambia el signo?", "La derivada es -2x.")
  assert.equal(response.headers.get("x-vercel-ai-ui-message-stream"), "v1")
  const chunks = await parts(response)
  const output = chunks.find(part => part.type === "tool-output-available")
  assert.ok(output.output.html.includes("connect-src 'none'"))
  assert.ok(output.output.html.includes("Pasos"))
  const request = model.doStreamCalls[0]
  assert.deepEqual(request.toolChoice, { type: "tool", toolName: "renderExplanation" })
  assert.equal(request.tools?.[0].name, "renderExplanation")
  assert.ok(JSON.stringify(request.prompt).includes("Vercel AI SDK UI"))
  assert.ok(JSON.stringify(request.prompt).includes("¿Por qué cambia el signo?"))
})

test("incomplete model HTML produces a tool error instead of a renderable artifact", async () => {
  const chunks = await parts(explanationStream(modelFor("<div>Incompleto</div>"), "Duda", "Página"))
  assert.ok(chunks.some(part => part.type === "tool-output-error"))
  assert.ok(!chunks.some(part => part.type === "tool-output-available"))
})

test("the UI stream forwards only the verified free fallbacks supplied by the selector", async () => {
  const model = modelFor("<html><head></head><body>Pasos</body></html>")
  const fallbackModels = ["inclusionai/ling-3.1-flash-free"]
  await parts(explanationStream(model, "Explicalo", "Página", { fallbackModels, maxOutputTokens: 8192 }))
  assert.deepEqual(model.doStreamCalls[0].providerOptions?.gateway, { models: fallbackModels })
  assert.equal(model.doStreamCalls[0].maxOutputTokens, 8192)
})
