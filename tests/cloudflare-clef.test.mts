import assert from "node:assert/strict"
import test from "node:test"
import { evaluateClefFlash, getClefConfiguration } from "../lib/server/cloudflare-clef.ts"

test("Clef requiere el token y la cuenta antes de realizar una llamada", async (t) => {
  const originalToken = process.env.cloudflareapi
  const originalAccount = process.env.CLOUDFLARE_ACCOUNT_ID
  t.after(() => {
    if (originalToken === undefined) delete process.env.cloudflareapi
    else process.env.cloudflareapi = originalToken
    if (originalAccount === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID
    else process.env.CLOUDFLARE_ACCOUNT_ID = originalAccount
  })
  delete process.env.cloudflareapi
  delete process.env.CLOUDFLARE_ACCOUNT_ID
  assert.deepEqual(getClefConfiguration().missing, ["cloudflareapi", "CLOUDFLARE_ACCOUNT_ID"])
  let called = false
  await assert.rejects(evaluateClefFlash("dictado", {}, async () => {
    called = true
    return Response.json({})
  }), /Falta configurar/)
  assert.equal(called, false)
})

test("Clef conserva el estado y las preguntas definidos por el flujo y procesa el sobre REST", async (t) => {
  const originalToken = process.env.cloudflareapi
  const originalAccount = process.env.CLOUDFLARE_ACCOUNT_ID
  t.after(() => {
    if (originalToken === undefined) delete process.env.cloudflareapi
    else process.env.cloudflareapi = originalToken
    if (originalAccount === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID
    else process.env.CLOUDFLARE_ACCOUNT_ID = originalAccount
  })
  process.env.cloudflareapi = " test-token "
  process.env.CLOUDFLARE_ACCOUNT_ID = "account-id"
  const state = { subject: "Álgebra", transcript: "repasar matrices" }
  const questions = { review: { type: "noul" as const, instructions: "¿Quiere repasar?" } }
  const result = { answers: { review: 0.9 }, usage: { input_tokens: 20 } }
  const evaluation = await evaluateClefFlash(state, questions, async (url, options) => {
    assert.equal(url, "https://api.cloudflare.com/client/v4/accounts/account-id/ai/run/@cf/cloudflare/clef-flash")
    assert.equal(new Headers(options?.headers).get("Authorization"), "Bearer test-token")
    assert.deepEqual(JSON.parse(String(options?.body)), { model: "clef-flash", state, questions })
    assert.equal(options?.cache, "no-store")
    return Response.json({ success: true, result })
  })
  assert.deepEqual(evaluation, result)
  await assert.rejects(evaluateClefFlash(state, questions, async () => Response.json({ success: false })), /inválida/)
  await assert.rejects(evaluateClefFlash(state, questions, async () => Response.json({ result: { answers: {} } })), /inválida/)
  await assert.rejects(evaluateClefFlash(state, questions, async () => new Response("test-token", { status: 403 })), (error: Error) => {
    assert.match(error.message, /HTTP 403/)
    assert.doesNotMatch(error.message, /test-token/)
    return true
  })
  await assert.rejects(evaluateClefFlash(state, {}), /entre 1 y 64/)
})
