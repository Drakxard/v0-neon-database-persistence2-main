import assert from "node:assert/strict"
import test from "node:test"
import { build } from "esbuild"

test("POST TTS exige sesión, valida la entrada y devuelve audio sin cache ni secretos", async (t) => {
  const state = globalThis as unknown as { ttsDenied?: boolean }
  const originalFetch = globalThis.fetch
  const token = process.env.apittshd
  const endpoint = process.env.conexionttshd
  t.after(() => {
    globalThis.fetch = originalFetch
    delete state.ttsDenied
    if (token === undefined) delete process.env.apittshd; else process.env.apittshd = token
    if (endpoint === undefined) delete process.env.conexionttshd; else process.env.conexionttshd = endpoint
  })
  const bundled = await build({
    entryPoints: ["app/api/tts/route.ts"], bundle: true, write: false, platform: "node", format: "esm",
    plugins: [{ name: "test-auth", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/authz$/ }, () => ({ path: "auth", namespace: "test-auth" }))
      builder.onLoad({ filter: /.*/, namespace: "test-auth" }, () => ({ contents: `export async function requireAuthSession() {
        return { response: globalThis.ttsDenied ? Response.json({ error: 'Unauthorized' }, { status: 401 }) : null };
      }` }))
    } }],
  })
  const { POST } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`)
  let called = 0
  globalThis.fetch = async () => { called++; return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/mpeg" } }) }
  const request = (value: unknown) => new Request("https://app.test/api/tts", { method: "POST", body: JSON.stringify(value) })
  state.ttsDenied = true
  assert.equal((await POST(request({ modelId: "tts-hd", text: "Hola" }))).status, 401)
  assert.equal(called, 0)
  state.ttsDenied = false
  const malformed = await POST(new Request("https://app.test/api/tts", { method: "POST", body: "{" }))
  assert.equal(malformed.status, 400)
  assert.equal((await POST(request({ modelId: "tts-hd", voiceId: "eve", text: "Hola" }))).status, 400)
  assert.equal((await POST(request({ modelId: "melotts", text: "Hola" }))).status, 400)
  delete process.env.apittshd
  assert.equal((await POST(request({ modelId: "tts-hd", text: "Hola" }))).status, 503)
  assert.equal(called, 0)
  process.env.apittshd = "secret-route-test"
  process.env.conexionttshd = "https://test-resource.openai.azure.com"
  const response = await POST(request({ modelId: "tts-hd", text: "Hola" }))
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("Content-Type"), "audio/mpeg")
  assert.equal(response.headers.get("Cache-Control"), "no-store")
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([1, 2, 3]))
  assert.equal(called, 1)
  globalThis.fetch = async () => { throw new Error("secret-route-test") }
  const failed = await POST(request({ modelId: "tts-hd", text: "Hola" }))
  assert.equal(failed.status, 502)
  assert.doesNotMatch(await failed.text(), /secret-route-test/)
})
