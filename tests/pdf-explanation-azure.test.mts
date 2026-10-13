import assert from "node:assert/strict"
import test from "node:test"
import { generateText } from "ai"
import { azureExplanationConfig, azureExplanationModel } from "../lib/server/pdf-explanation-azure.ts"
import { explanationFailure } from "../lib/pdf-explanation-errors.ts"

test("Azure configuration accepts the saved project endpoint and resource endpoints", () => {
  assert.equal(azureExplanationConfig({}), null)
  const project = azureExplanationConfig({ gpt5mini: "test-key", conexiongpt5mini: "https://example.services.ai.azure.com/api/projects/study" })!
  assert.equal(project.baseURL, "https://example.services.ai.azure.com/api/projects/study/openai/v1")
  assert.equal(project.deployment, "gpt-5-mini")
  assert.equal(azureExplanationConfig({ gpt5mini: "test-key", conexiongpt5mini: "https://example.openai.azure.com/openai/v1/", AZURE_OPENAI_DEPLOYMENT: "my-mini" })!.deployment, "my-mini")
  assert.throws(() => azureExplanationConfig({ gpt5mini: "test-key" }), /conexiongpt5mini/)
  assert.throws(() => azureExplanationConfig({ gpt5mini: "test-key", conexiongpt5mini: "https://unrelated.example" }), /Azure/)
  assert.throws(() => azureExplanationConfig({ gpt5mini: "test-key", conexiongpt5mini: "https://example.openai.azure.com/?key=test-key" }), /sin claves/)
})

test("real Azure SDK uses the project Responses endpoint, secret header and deployment name", async t => {
  let calls = 0
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls++
    assert.equal(String(url), "https://example.services.ai.azure.com/api/projects/study/openai/v1/responses")
    assert.equal(new Headers(init.headers).get("api-key"), "test-key")
    assert.ok(!String(url).includes("test-key"))
    const body = JSON.parse(init.body as string)
    assert.equal(body.model, "my-mini")
    assert.deepEqual(body.reasoning, { effort: "low" })
    assert.equal(body.max_output_tokens, 12_000)
    return Response.json({ id: "resp-test", created_at: 1, model: "gpt-5-mini", status: "completed",
      output: [{ type: "message", id: "msg-test", role: "assistant", content: [{ type: "output_text", text: "Listo", annotations: [] }] }],
      usage: { input_tokens: 5, output_tokens: 3, total_tokens: 8 } })
  })
  const config = azureExplanationConfig({ gpt5mini: "test-key", conexiongpt5mini: "https://example.services.ai.azure.com/api/projects/study", AZURE_OPENAI_DEPLOYMENT: "my-mini" })!
  const result = await generateText({ model: azureExplanationModel(config), prompt: "Explicalo", reasoning: "low", providerOptions: { openai: { forceReasoning: true, reasoningEffort: "low", reasoningSummary: null } }, maxOutputTokens: 12_000, maxRetries: 0 })
  assert.equal(result.text, "Listo")
  assert.equal(calls, 1)
  assert.match(explanationFailure({ statusCode: 404 }, "azure").message, /AZURE_OPENAI_DEPLOYMENT/)
  assert.match(explanationFailure({ statusCode: 429 }, "azure").message, /cuota/)
})
