import assert from "node:assert/strict"
import test from "node:test"
import { createRequire } from "node:module"
import { build } from "esbuild"
import { isSubjectVoiceServerRequest } from "../lib/subject-voice-api.ts"

const require = createRequire(import.meta.url)
const { NextRequest } = require("next/server")
// Execute the real proxy, including its local-mode checks, rather than mocking provider routes.
const compiled = await build({ entryPoints: ["proxy.ts"], bundle: true, write: false, platform: "node", format: "cjs", packages: "external" })
const proxyModule = { exports: {} as { proxy?: (request: unknown) => Response } }
new Function("require", "module", "exports", compiled.outputFiles[0].text)(require, proxyModule, proxyModule.exports)
const proxy = proxyModule.exports.proxy!

test("el proxy permite consultar voz y ejecutar Datalab/Clef con workspace local", () => {
  for (const [path, method] of [
    ["/api/subject-voice", "GET"],
    ["/api/subject-voice/pdf-extraction", "POST"],
    ["/api/subject-voice/pdf-extraction?token=signed-job", "GET"],
    ["/api/subject-voice/pdf-evaluate", "POST"],
    ["/api/subject-voice/pdf-refine", "POST"],
  ]) {
    const response = proxy(new NextRequest(`https://app.test${path}`, { method }))
    assert.equal(response.status, 200, `${method} ${path}`)
    assert.equal(response.headers.get("x-middleware-next"), "1")
    assert.notEqual(response.headers.get("x-data-source"), "blocked-server-api")
    assert.equal(isSubjectVoiceServerRequest(new URL(`https://app.test${path}`).pathname, method), true)
  }
})

test("la excepción no habilita rutas desconocidas, métodos adicionales ni APIs de datos locales", async () => {
  for (const [path, method] of [
    ["/api/subject-voice-unknown", "GET"],
    ["/api/subject-voice/unknown", "POST"],
    ["/api/subject-voice/pdf-extraction", "DELETE"],
    ["/api/subject-voice/pdf-evaluate", "GET"],
    ["/api/subject-day-materials", "GET"],
  ]) {
    const response = proxy(new NextRequest(`https://app.test${path}`, { method }))
    assert.equal(response.status, 501, `${method} ${path}`)
    assert.equal(response.headers.get("x-data-source"), "blocked-server-api")
    assert.equal(isSubjectVoiceServerRequest(path, method), false)
    assert.match((await response.json()).error, /deshabilitado en modo local/)
  }
})
