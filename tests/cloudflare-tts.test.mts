import assert from "node:assert/strict"
import test from "node:test"
import { TTS_MODELS, ttsInput, validateTtsRequest } from "../lib/tts-models.ts"
import { generateCloudflareTts } from "../lib/server/cloudflare-tts.ts"

test("catálogo español conserva el orden y solo acepta modelos y voces propios", () => {
  assert.deepEqual(TTS_MODELS.map((m) => m.id), ["melotts", "gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts", "gemini-3.1-flash-tts", "tts-1", "grok-tts", "tts-1.5-mini", "tts-2", "tts-1-hd", "aura-2-es", "tts-1.5-max"])
  assert.equal(TTS_MODELS[0].voices.length, 0)
  const aura = TTS_MODELS.find((m) => m.family === "aura")!
  assert.equal(aura.cloudflareId, "@cf/deepgram/aura-2-es")
  assert.throws(() => validateTtsRequest({ modelId: "aura-2-en", text: "Hola" }), /modelo/)
  assert.throws(() => validateTtsRequest({ modelId: aura.id, voiceId: "asteria", text: "Hola" }), /voz/)
  assert.throws(() => validateTtsRequest({ modelId: "melotts", voiceId: "es", text: "Hola" }), /voz/)
  assert.throws(() => validateTtsRequest({ modelId: "tts-1", text: "   " }), /texto/)
  assert.throws(() => validateTtsRequest({ modelId: "tts-1.5-mini", text: "a".repeat(2001) }), /2000/)
  const spanish = "¡Hola!\n¿Cómo estás?"
  for (const model of TTS_MODELS) {
    const request = validateTtsRequest({ modelId: model.id, text: spanish })
    assert.equal(request.text, spanish)
    assert.equal(request.voiceId, model.defaultVoice)
    assert.ok(!request.voiceId || model.voices.includes(request.voiceId))
    assert.equal(new Set(model.voices).size, model.voices.length)
  }
})

test("adaptadores respetan los parámetros expuestos por Cloudflare y el español", () => {
  const text = "Probando una voz en español."
  const input = (id: string) => {
    const m = TTS_MODELS.find((m) => m.id === id)!
    return ttsInput(m, text, m.defaultVoice)
  }
  assert.deepEqual(input("melotts"), { prompt: text, lang: "es" })
  assert.deepEqual(input("aura-2-es"), { text, speaker: "aquila", encoding: "mp3" })
  assert.deepEqual(input("grok-tts"), { text, voice_id: "eve", language: "es-MX" })
  assert.deepEqual(input("tts-1"), { text, voice: "alloy", response_format: "mp3", speed: 1 })
  assert.deepEqual(input("gemini-3.8-flash-tts"), { text, voice: "Zephyr" })
  assert.deepEqual(input("tts-2"), { text, voice_id: "Dennis", output_format: "mp3", temperature: 1, timestamp_type: "none" })
})

test("Cloudflare TTS normaliza binario, base64 y URL sin exponer credenciales", async (t) => {
  const token = process.env.cloudflareapi
  const account = process.env.CLOUDFLARE_ACCOUNT_ID
  t.after(() => {
    if (token === undefined) delete process.env.cloudflareapi; else process.env.cloudflareapi = token
    if (account === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID; else process.env.CLOUDFLARE_ACCOUNT_ID = account
  })
  process.env.cloudflareapi = " secret-test-token "
  process.env.CLOUDFLARE_ACCOUNT_ID = "test-account"
  const audio = Buffer.from("test audio")
  for (const id of ["melotts", "aura-2-es"]) {
    const result = await generateCloudflareTts({ modelId: id, text: "Hola" }, undefined, async (url, options) => {
      assert.match(String(url), /test-account\/ai\/run\/@cf\//)
      assert.equal(new Headers(options?.headers).get("Authorization"), "Bearer secret-test-token")
      assert.ok(!("model" in JSON.parse(String(options?.body))))
      return new Response(audio, { headers: { "Content-Type": "audio/mpeg" } })
    })
    assert.deepEqual(result.audio, audio)
    assert.equal(result.contentType, "audio/mpeg")
  }
  const base64 = await generateCloudflareTts({ modelId: "gemini-3.8-flash-tts", voiceId: "Kore", text: "Hola" }, undefined, async (url, options) => {
    assert.equal(String(url), "https://api.cloudflare.com/client/v4/accounts/test-account/ai/run")
    assert.deepEqual(JSON.parse(String(options?.body)), { model: "google/gemini-3.8-flash-tts", input: { text: "Hola", voice: "Kore" } })
    return Response.json({ audio: audio.toString("base64") })
  })
  assert.deepEqual(base64.audio, audio)
  assert.equal(base64.contentType, "audio/wav")
  let calls = 0
  const signed = await generateCloudflareTts({ modelId: "tts-1", text: "Hola" }, undefined, async (url, options) => {
    if (++calls === 1) return Response.json({ state: "Completed", result: { audio: "https://example.r2.dev/audio.mp3?signature=abc" } })
    assert.equal(String(url), "https://example.r2.dev/audio.mp3?signature=abc")
    assert.equal(new Headers(options?.headers).get("Authorization"), null)
    assert.equal(options?.redirect, "error")
    return new Response(audio, { headers: { "Content-Type": "audio/mpeg" } })
  })
  assert.deepEqual(signed.audio, audio)
  assert.equal(calls, 2)
  for (const payload of [{ success: false }, { state: "Failed" }, {}, { result: { audio: "https://127.0.0.1/secret" } }, { audio: "not:base64" }]) {
    await assert.rejects(generateCloudflareTts({ modelId: "tts-1", text: "Hola" }, undefined, async () => Response.json(payload)), /Cloudflare/)
  }
  await assert.rejects(generateCloudflareTts({ modelId: "tts-1", text: "Hola" }, undefined, async () => new Response("secret-test-token", { status: 403 })), (error: Error) => {
    assert.match(error.message, /HTTP 403.*permisos/)
    assert.doesNotMatch(error.message, /secret-test-token/)
    return true
  })
  await assert.rejects(generateCloudflareTts({ modelId: "tts-1", text: "Hola" }, undefined, async () => new Response(null, { status: 402 })), /créditos/)
  const aborted = new AbortController()
  aborted.abort()
  await assert.rejects(generateCloudflareTts({ modelId: "tts-1", text: "Hola" }, aborted.signal, async (_, options) => {
    options?.signal?.throwIfAborted()
    return Response.json({})
  }), /abort/i)
  delete process.env.cloudflareapi
  let fetched = false
  await assert.rejects(generateCloudflareTts({ modelId: "tts-1", text: "Hola" }, undefined, async () => { fetched = true; return Response.json({}) }), /Falta configurar/)
  assert.equal(fetched, false)
})
