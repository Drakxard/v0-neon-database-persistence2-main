import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  buildInscreenConfigCookie,
  openInscreenUserConfig,
  openInscreenUserConfigParts,
  sealInscreenUserConfig,
  splitInscreenUserConfig,
} from "../lib/inscreen-user-config.ts"

const config = {
  GROQ_API_KEY: "gsk_example_secret",
  MARKER_API: "marker_example_secret",
  R2_BUCKET_NAME: "bucket",
  R2_ACCESS_KEY_ID: "access-key",
  R2_SECRET_ACCESS_KEY: "r2-secret",
  R2_ENDPOINT: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
}

test("User.InScreen cifra todas las credenciales y solo abre con la semilla del despliegue", () => {
  const previousSeed = process.env.INSCREEN_CONFIG_SEED
  try {
    process.env.INSCREEN_CONFIG_SEED = "seed-de-prueba-con-mas-de-treinta-y-dos-caracteres"
    const sealed = sealInscreenUserConfig(config)
    assert.ok(sealed.startsWith("v1."))
    assert.doesNotMatch(sealed, /gsk_example_secret|marker_example_secret|r2-secret/)
    assert.deepEqual(openInscreenUserConfig(sealed), config)

    process.env.INSCREEN_CONFIG_SEED = "otra-semilla-distinta-con-mas-de-treinta-y-dos"
    assert.throws(() => openInscreenUserConfig(sealed), /No se pudo desbloquear/)
  } finally {
    if (previousSeed === undefined) delete process.env.INSCREEN_CONFIG_SEED
    else process.env.INSCREEN_CONFIG_SEED = previousSeed
  }
})

test("la Mitad B se entrega como cookie HttpOnly y solo el servidor puede unir ambas partes", () => {
  const previousSeed = process.env.INSCREEN_CONFIG_SEED
  const previousNodeEnv = process.env.NODE_ENV
  try {
    process.env.INSCREEN_CONFIG_SEED = "seed-de-prueba-con-mas-de-treinta-y-dos-caracteres"
    process.env.NODE_ENV = "production"
    const { fileHalf, cookieHalf } = splitInscreenUserConfig(config)
    assert.ok(fileHalf)
    assert.ok(cookieHalf)
    assert.doesNotMatch(fileHalf, /gsk_example_secret|marker_example_secret|r2-secret/)
    assert.doesNotMatch(cookieHalf, /gsk_example_secret|marker_example_secret|r2-secret/)
    const cookie = buildInscreenConfigCookie(cookieHalf)
    assert.match(cookie, /HttpOnly/)
    assert.match(cookie, /SameSite=Strict/)
    assert.match(cookie, /Secure/)
    assert.match(cookie, /Max-Age=31536000/)
    const request = new Request("https://example.test", {
      headers: { Cookie: `inscreen_config_b=${encodeURIComponent(cookieHalf)}` },
    })
    assert.deepEqual(openInscreenUserConfigParts(fileHalf, request), config)
    assert.throws(
      () => openInscreenUserConfigParts(`${fileHalf}alterada`, request),
      /No se pudo desbloquear/
    )
  } finally {
    if (previousSeed === undefined) delete process.env.INSCREEN_CONFIG_SEED
    else process.env.INSCREEN_CONFIG_SEED = previousSeed
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnv
  }
})

test("el arranque busca las dos mitades y ofrece vinculacion por QR como cuarto paso", () => {
  const provider = readFileSync(new URL("../components/local-workspace-provider.tsx", import.meta.url), "utf8")
  const client = readFileSync(new URL("../lib/local-workspace-client.ts", import.meta.url), "utf8")
  const r2 = readFileSync(new URL("../lib/r2.ts", import.meta.url), "utf8")

  assert.match(client, /User\.InScreen/)
  assert.match(client, /version === 2/)
  assert.doesNotMatch(client, /persistInscreenBrowserHalf/)
  assert.match(provider, /Paso \{step \+ 1\} de 4/)
  assert.match(provider, /provider\/pairing\/create/)
  assert.match(provider, /QRCode\.toDataURL/)
  assert.match(provider, /bg-white/)
  assert.match(provider, /config\/seal/)
  assert.match(provider, /config\/unlock/)
  assert.match(provider, /fileHalf/)
  assert.match(provider, /Omitir por ahora/)
  assert.match(provider, /event\.key !== "\|"/)
  assert.match(provider, /target\.closest\("input, textarea, select, \[contenteditable='true'\]"\)/)
  assert.match(provider, /const unlocked = await unlockWorkspaceInscreenConfig\(rootHandle\)/)
  assert.match(provider, /if \(unlocked\.ok\) \{[\s\S]*?setConfigStep\(3\)[\s\S]*?await createPairingQr\(\)/)
  assert.match(provider, /setConfigStep\(0\)[\s\S]*?setError\(unlocked\.error\)/)
  assert.match(provider, /inscreen\.config-skipped\.v1/)
  assert.match(r2, /getInscreenRuntimeSecret/)
})

test("la aplicacion y el iframe PDF.js envian la Mitad A en cada llamada protegida", () => {
  const interceptor = readFileSync(new URL("../components/local-fetch-interceptor.tsx", import.meta.url), "utf8")
  const viewer = readFileSync(new URL("../public/pdfjs/web/viewer-custom.js", import.meta.url), "utf8")

  assert.match(interceptor, /x-inscreen-config-half/)
  assert.match(viewer, /loadInscreenConfigFileHalf/)
  assert.match(viewer, /x-inscreen-config-half/)
  assert.match(viewer, /inscreen\.config-skipped\.v1/)
  assert.match(viewer, /InscreenConfigurationUnavailable/)
  assert.match(viewer, /inscreenApiFetch\("\/api\/pdf-translate"/)
  assert.doesNotMatch(viewer, /inscreenApiFetch\("\/api\/inscreen\/marker-transcribe"/)
})
