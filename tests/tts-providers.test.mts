import assert from "node:assert/strict"
import test from "node:test"
import { TTS_MODELS, validateTtsRequest } from "../lib/tts-models.ts"
import { azureTtsConfig, generateTts } from "../lib/server/tts.ts"

test("catálogo ofrece solo Azure HD y Grok de Gateway, con voces y límites propios", () => {
  assert.deepEqual(TTS_MODELS.map((m) => m.id), ["tts-hd", "spacexai/grok-tts"])
  assert.equal(validateTtsRequest({ modelId: "tts-hd", text: "Hola" }).voiceId, "alloy")
  assert.equal(validateTtsRequest({ modelId: "spacexai/grok-tts", text: "Hola" }).voiceId, "eve")
  for (const modelId of ["melotts", "aura-2-es", "grok-tts", "tts-1-hd"]) assert.throws(() => validateTtsRequest({ modelId, text: "Hola" }), /modelo/)
  assert.throws(() => validateTtsRequest({ modelId: "tts-hd", voiceId: "eve", text: "Hola" }), /voz/)
  assert.throws(() => validateTtsRequest({ modelId: "spacexai/grok-tts", voiceId: "alloy", text: "Hola" }), /voz/)
  assert.throws(() => validateTtsRequest({ modelId: "tts-hd", text: " " }), /texto/)
  assert.throws(() => validateTtsRequest({ modelId: "tts-hd", text: "a".repeat(4097) }), /4096/)
  assert.throws(() => validateTtsRequest({ modelId: "spacexai/grok-tts", text: "a".repeat(15001) }), /15000/)
})

test("Azure acepta recurso, despliegue completo y v1; no envía claves a destinos arbitrarios", () => {
  const config = (conexionttshd: string, deployment?: string) => azureTtsConfig({ apittshd: "test-key", conexionttshd, AZURE_TTS_HD_DEPLOYMENT: deployment })
  assert.equal(config("https://test.openai.azure.com/").url, "https://test.openai.azure.com/openai/deployments/tts-hd/audio/speech?api-version=2025-04-01-preview")
  assert.equal(config("https://test.openai.azure.com/", "custom-hd").deployment, "custom-hd")
  const full = "https://test.openai.azure.com/openai/deployments/my-voice/audio/speech?api-version=2024-06-01"
  assert.equal(config(full).url, full)
  assert.equal(config(full).deployment, "my-voice")
  assert.equal(config("https://test.services.ai.azure.com/openai/v1").url, "https://test.services.ai.azure.com/openai/v1/audio/speech")
  assert.equal(config("https://test.services.ai.azure.com/api/projects/demo/openai/v1").url, "https://test.services.ai.azure.com/api/projects/demo/openai/v1/audio/speech")
  for (const endpoint of ["http://test.openai.azure.com", "https://example.com", "https://secret@test.openai.azure.com", "https://test.openai.azure.com/?api-key=secret", "https://test.openai.azure.com/responses"]) assert.throws(() => config(endpoint), /conexionttshd/)
  assert.throws(() => azureTtsConfig({}), /Falta configurar/)
})

test("cada proveedor usa exclusivamente su clave, parámetros y formato de audio", async (t) => {
  const names = ["apittshd", "conexionttshd", "gatewayia", "AZURE_TTS_HD_DEPLOYMENT", "cloudflareapi", "CLOUDFLARE_ACCOUNT_ID"]
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]))
  t.after(() => { for (const name of names) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name] } })
  delete process.env.cloudflareapi
  delete process.env.CLOUDFLARE_ACCOUNT_ID
  delete process.env.gatewayia
  process.env.apittshd = "azure-secret"
  process.env.conexionttshd = "https://test.openai.azure.com"
  process.env.AZURE_TTS_HD_DEPLOYMENT = "custom-hd"
  const bytes = Buffer.from("audio")
  const azure = await generateTts({ modelId: "tts-hd", voiceId: "nova", text: "¡Hola!\n¿Cómo estás?" }, undefined, async (url, options) => {
    assert.equal(String(url), "https://test.openai.azure.com/openai/deployments/custom-hd/audio/speech?api-version=2025-04-01-preview")
    const headers = new Headers(options?.headers)
    assert.equal(headers.get("api-key"), "azure-secret")
    assert.equal(headers.get("Authorization"), null)
    assert.deepEqual(JSON.parse(String(options?.body)), { model: "custom-hd", input: "¡Hola!\n¿Cómo estás?", voice: "nova", response_format: "mp3", speed: 1 })
    assert.equal(options?.redirect, "error")
    return new Response(bytes, { headers: { "Content-Type": "audio/mpeg" } })
  })
  assert.deepEqual(azure.audio, bytes)
  delete process.env.apittshd
  delete process.env.conexionttshd
  process.env.gatewayia = "gateway-secret"
  const grok = await generateTts({ modelId: "spacexai/grok-tts", voiceId: "ara", text: "Hola" }, undefined, async (url, options) => {
    assert.equal(String(url), "https://ai-gateway.vercel.sh/v4/ai/speech-model")
    const headers = new Headers(options?.headers)
    assert.equal(headers.get("Authorization"), "Bearer gateway-secret")
    assert.equal(headers.get("api-key"), null)
    assert.equal(headers.get("ai-model-id"), "spacexai/grok-tts")
    assert.equal(headers.get("ai-speech-model-specification-version"), "4")
    assert.deepEqual(JSON.parse(String(options?.body)), { text: "Hola", voice: "ara", outputFormat: "mp3", language: "es-MX" })
    return Response.json({ audio: bytes.toString("base64") })
  })
  assert.deepEqual(grok.audio, bytes)
  assert.equal(grok.contentType, "audio/mpeg")
  await assert.rejects(generateTts({ modelId: "tts-hd", text: "Hola" }), /apittshd/)
  for (const status of [401, 402, 404, 429, 500]) {
    await assert.rejects(generateTts({ modelId: "spacexai/grok-tts", text: "Hola" }, undefined, async () => new Response("gateway-secret", { status })), (error: Error) => {
      assert.match(error.message, new RegExp(`Vercel AI Gateway.*HTTP ${status}`))
      assert.doesNotMatch(error.message, /gateway-secret/)
      return true
    })
  }
  for (const payload of [{}, { audio: "" }, { audio: "https://example.com/audio" }]) await assert.rejects(generateTts({ modelId: "spacexai/grok-tts", text: "Hola" }, undefined, async () => Response.json(payload)), /audio/)
  const canceled = new AbortController()
  canceled.abort()
  await assert.rejects(generateTts({ modelId: "spacexai/grok-tts", text: "Hola" }, canceled.signal, async (_, options) => { options?.signal?.throwIfAborted(); return Response.json({}) }), /abort/i)
  delete process.env.gatewayia
  let called = false
  await assert.rejects(generateTts({ modelId: "spacexai/grok-tts", text: "Hola" }, undefined, async () => { called = true; return Response.json({}) }), /gatewayia/)
  assert.equal(called, false)
})
