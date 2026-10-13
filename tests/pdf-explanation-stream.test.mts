import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { MockLanguageModelV4, simulateReadableStream } from "ai/test"
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider"
import { explanationStream } from "../lib/server/pdf-explanation-stream.ts"
import { DefaultChatTransport, readUIMessageStream } from "ai"
import { lessonHtml } from "../lib/pdf-explanation-lesson.ts"

const lesson = { title: "Costo de búsqueda", steps: [
  { title: "Encontrar la clave", text: "Se calcula la cubeta inicial y se compara la clave.", items: ["h(k)", "Comparación", "Clave encontrada"], result: "Una búsqueda directa requiere una comparación." },
  { title: "Resolver una colisión", text: "Si la primera cubeta no coincide, se prueban otras.", items: ["Cubeta ocupada", "Nuevo intento", "Coincidencia"], result: "Los intentos infructuosos aumentan el costo." },
] }

const reportedLesson = JSON.parse(readFileSync(new URL("./fixtures/pdf-explanation-string-steps.json", import.meta.url), "utf8"))

test("the reported Gateway response with JSON-string steps renders through the real SDK UI reader", async () => {
  const model = modelFor("", JSON.stringify(reportedLesson))
  const response = explanationStream(model, "Explicalo", "Costo de la búsqueda")
  const transport = new DefaultChatTransport({ fetch: async () => response })
  const stream = await transport.sendMessages({ trigger: "submit-message", chatId: "reported-failure", messageId: undefined, messages: [] })
  let html = ""
  for await (const message of readUIMessageStream({ stream, terminateOnError: true })) {
    for (const part of message.parts) {
      if (part.type === "tool-renderExplanation" && part.state === "output-available") html = (part.output as { html: string }).html
    }
  }
  assert.ok(html.includes(reportedLesson.title))
  assert.ok(html.includes("Búsqueda exitosa: menos intentos"))
  assert.ok(html.includes("connect-src 'none'"))
  assert.equal(model.doStreamCalls.length, 1)
})

function textModel(text: string, reason: "stop" | "length" = "stop") {
  const chunks: LanguageModelV4StreamPart[] = [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "text-1" },
    { type: "text-delta", id: "text-1", delta: text },
    { type: "text-end", id: "text-1" },
    { type: "finish", finishReason: { unified: reason, raw: undefined }, usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 20, text: 20, reasoning: undefined },
    } },
  ]
  return new MockLanguageModelV4({ doStream: async () => ({ stream: simulateReadableStream({ chunks }) }) })
}

function modelFor(html: string, input = JSON.stringify({ html })) {
  const chunks: LanguageModelV4StreamPart[] = [
    { type: "stream-start", warnings: [] },
    { type: "tool-call", toolCallId: "render-1", toolName: "renderExplanation", input },
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

test("Azure uses low reasoning with custom deployment names and keeps room for reasoning tokens", async () => {
  const model = modelFor("<html><head></head><body>Pasos</body></html>")
  const chunks = await parts(explanationStream(model, "Explicalo", "Costo de búsqueda", { provider: "azure", reasoning: "low", maxOutputTokens: 12_000 }))
  assert.ok(chunks.some(part => part.type === "tool-output-available"))
  assert.equal(model.doStreamCalls[0].maxOutputTokens, 12_000)
  assert.deepEqual(model.doStreamCalls[0].providerOptions?.openai, { forceReasoning: true, reasoningEffort: "low", reasoningSummary: null })
})

test("request instructs the Gateway model to return UI through renderExplanation and streams validated HTML", async () => {
  const model = modelFor("<html><head></head><body>Pasos</body></html>")
  const response = explanationStream(model, "¿Por qué cambia el signo?", "La derivada es -2x.")
  assert.equal(response.headers.get("x-vercel-ai-ui-message-stream"), "v1")
  const chunks = await parts(response)
  const output = chunks.find(part => part.type === "tool-output-available")
  assert.ok(output.output.html.includes("connect-src 'none'"))
  assert.ok(output.output.html.includes("Pasos"))
  const request = model.doStreamCalls[0]
  assert.deepEqual(request.toolChoice, { type: "auto" })
  assert.equal(request.tools?.[0].name, "renderExplanation")
  assert.equal(request.reasoning, "none")
  assert.equal(request.maxOutputTokens, 1800)
  assert.ok(JSON.stringify(request.prompt).includes("Vercel AI SDK UI"))
  assert.ok(JSON.stringify(request.prompt).includes("¿Por qué cambia el signo?"))
})

test("incomplete model HTML produces a tool error instead of a renderable artifact", async () => {
  const chunks = await parts(explanationStream(modelFor("<div>Incompleto</div>"), "Duda", "Página"))
  assert.ok(chunks.some(part => part.type === "error" && part.errorText.includes("sin entregar HTML completo")))
  assert.ok(!chunks.some(part => part.type === "tool-output-available"))
})

test("the UI stream forwards only the verified free fallbacks supplied by the selector", async () => {
  const model = modelFor("<html><head></head><body>Pasos</body></html>")
  const fallbackModels = ["inclusionai/ling-3.1-flash-free"]
  await parts(explanationStream(model, "Explicalo", "Página", { fallbackModels, maxOutputTokens: 8192 }))
  assert.deepEqual(model.doStreamCalls[0].providerOptions?.gateway, { models: fallbackModels })
  assert.equal(model.doStreamCalls[0].maxOutputTokens, 1800)
})

test("short lesson content becomes complete animated HTML without asking the model to generate code", async () => {
  for (const model of [modelFor("", JSON.stringify(lesson)), textModel(JSON.stringify(lesson))]) {
    const chunks = await parts(explanationStream(model, "Explicalo", "Página"))
    const artifact = chunks.find(part => part.type === "tool-output-available" || part.type === "data-explanation")
    const html = artifact.output?.html || artifact.data?.html
    assert.ok(html.includes("Costo de búsqueda"))
    assert.ok(html.includes("prefers-reduced-motion"))
    assert.ok(html.includes("pointer"))
    assert.ok(html.includes("connect-src 'none'"))
    assert.ok(JSON.stringify(model.doStreamCalls[0].prompt).includes("NO escribas HTML"))
  }
})

test("text-only free models can generate a lesson without tools or an application abort deadline", async () => {
  const model = textModel(JSON.stringify(lesson))
  const chunks = await parts(explanationStream(model, "Duda", "Página", { supportsTools: false }))
  assert.equal(model.doStreamCalls[0].tools, undefined)
  assert.ok(JSON.stringify(model.doStreamCalls[0].prompt).includes("directamente como texto"))
  assert.equal(model.doStreamCalls[0].abortSignal, undefined)
  assert.ok(chunks.some(part => part.type === "data-explanation" && part.data.html.includes("Costo de búsqueda")))
  assert.ok(!chunks.some(part => part.type === "error"))
})

test("lesson rendering treats model strings as text and cannot inject script tags", () => {
  const html = lessonHtml({ ...lesson, title: '</script><script>alert("injected")</script>' })
  assert.ok(!html.includes('<script>alert("injected")'))
  assert.ok(html.includes("\\u003c/script>"))
  assert.throws(() => lessonHtml({ title: "Incomplete", steps: [] }))
})

test("JSON-encoded arrays work for text delivery and nested items without weakening validation", async () => {
  const encoded = { ...lesson, steps: JSON.stringify(lesson.steps.map(step => ({ ...step, items: JSON.stringify(step.items) }))) }
  const chunks = await parts(explanationStream(textModel(JSON.stringify(encoded)), "Explicalo", "Página", { supportsTools: false }))
  assert.ok(chunks.some(part => part.type === "data-explanation" && part.data.html.includes("Resolver una colisión")))
  for (const steps of ['[{"title":"Incompleto"}]', "[]", "not JSON", JSON.stringify(JSON.stringify(JSON.stringify(lesson.steps)))]) {
    assert.throws(() => lessonHtml({ ...lesson, steps }))
  }
  assert.throws(() => lessonHtml({ ...lesson, steps: [{ ...lesson.steps[0], items: '[]' }, lesson.steps[1]] }))
  const html = lessonHtml({ ...lesson, steps: JSON.stringify(lesson.steps.map(step => ({ ...step, items: JSON.stringify(['</script><script>alert(1)</script>', 'Seguro']) }))) })
  assert.ok(!html.includes('<script>alert(1)</script>'))
  assert.ok(html.includes('\\u003c/script>'))
})

test("a free model returning text instead of tools still delivers validated HTML through SDK UI", async () => {
  const html = "<html><head></head><body>Respuesta como texto</body></html>"
  const chunks = await parts(explanationStream(textModel(`Aquí está:\n\`\`\`html\n${html}\n\`\`\``), "Duda", "Página"))
  const artifact = chunks.find(part => part.type === "data-explanation")
  assert.ok(artifact.data.html.includes("Respuesta como texto"))
  assert.ok(artifact.data.html.includes("connect-src 'none'"))
  assert.equal(chunks.at(-1).type, "finish")
  assert.ok(!chunks.some(part => part.type === "error"))
})

test("empty or truncated output reports the cause rather than a successful empty stream", async () => {
  for (const [text, reason] of [["", "stop"], ["<html><body>Incompleto", "length"]] as const) {
    const chunks = await parts(explanationStream(textModel(text, reason), "Duda", "Página"))
    const error = chunks.find(part => part.type === "error")
    assert.ok(error.errorText.includes(reason === "length" ? "agotó su límite" : "sin entregar HTML completo"))
    assert.ok(!chunks.some(part => part.type === "finish" || part.type === "data-explanation"))
  }
})

test("Gateway rate-limit failures remain actionable and do not trigger HTML recovery", async () => {
  const recovery = textModel("<html><body>Unused</body></html>")
  const model = new MockLanguageModelV4({ doStream: async () => ({ stream: simulateReadableStream({ chunks: [
    { type: "stream-start", warnings: [] },
    { type: "error", error: { statusCode: 429, name: "APICallError" } },
  ] as LanguageModelV4StreamPart[] }) }) })
  const chunks = await parts(explanationStream(model, "Duda", "Página", { recoveryModel: recovery }))
  assert.ok(chunks.some(part => part.type === "error" && part.errorText.includes("429")))
  assert.equal(recovery.doStreamCalls.length, 0)
  assert.ok(!chunks.some(part => part.type === "finish"))
})

test("download diagnostics preserve Gateway permission and provider status without raw credentials", async () => {
  for (const statusCode of [403, 503]) {
    const model = new MockLanguageModelV4({ doStream: async () => ({ stream: simulateReadableStream({ chunks: [
      { type: "stream-start", warnings: [] },
      { type: "error", error: Object.assign(new Error("secret-key"), { statusCode, name: "APICallError", responseBody: "secret-key", generationId: "generation-test" }) },
    ] as LanguageModelV4StreamPart[] }) }) })
    const chunks = await parts(explanationStream(model, "Duda", "Página"))
    const debug = chunks.find(part => part.type === "data-explanation-debug" && part.data.stage === "error-gateway")
    assert.equal(debug.data.diagnostics.status, statusCode)
    assert.equal(debug.data.diagnostics.name, "APICallError")
    assert.equal(debug.data.diagnostics.generationId, "generation-test")
    assert.ok(!JSON.stringify(chunks).includes("secret-key"))
  }
})

test("invalid tool output automatically recovers through another verified free model and the real UI reader", async () => {
  const recovery = textModel("<html><head></head><body>Segundo modelo</body></html>")
  const response = explanationStream(modelFor("<div>Incompleto</div>"), "Duda", "Página", { recoveryModel: recovery })
  const transport = new DefaultChatTransport({ fetch: async () => response })
  const stream = await transport.sendMessages({ trigger: "submit-message", chatId: "test", messageId: undefined, messages: [] })
  let html = ""
  for await (const message of readUIMessageStream({ stream, terminateOnError: true })) {
    for (const part of message.parts) if (part.type === "data-explanation") html = (part.data as { html: string }).html
  }
  assert.ok(html.includes("Segundo modelo"))
  assert.equal(recovery.doStreamCalls.length, 1)
  assert.equal(recovery.doStreamCalls[0].tools, undefined)
  assert.equal(recovery.doStreamCalls[0].reasoning, "none")
  assert.ok(JSON.stringify(recovery.doStreamCalls[0].prompt).includes("directamente como texto"))
})

test("invalid tool JSON is diagnosed and cannot cancel recovery in the SDK UI reader", async () => {
  const raw = '{"html":"<html><body>Sin terminar'
  const recovery = textModel("<html><head></head><body>Recuperación válida</body></html>")
  const response = explanationStream(modelFor("", raw), "Duda", "Página", { recoveryModel: recovery })
  const transport = new DefaultChatTransport({ fetch: async () => response })
  const stream = await transport.sendMessages({ trigger: "submit-message", chatId: "test", messageId: undefined, messages: [] })
  let html = "", debug = ""
  for await (const message of readUIMessageStream({ stream, terminateOnError: true })) {
    for (const part of message.parts) {
      if (part.type === "data-explanation") html = (part.data as { html: string }).html
      if (part.type === "data-explanation-debug") debug += JSON.stringify(part.data)
      if (part.type === "tool-renderExplanation") assert.notEqual(part.state, "output-error")
    }
  }
  assert.ok(html.includes("Recuperación válida"))
  assert.ok(debug.includes("argumentos-herramienta-invalidos"))
  assert.ok(debug.includes("Sin terminar"))
})
