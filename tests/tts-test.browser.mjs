import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { build } from "esbuild"
import postcss from "postcss"
import tailwind from "@tailwindcss/postcss"
import { chromium } from "@playwright/test"

const assets = Promise.all([
  build({
    stdin: { contents: `
      import React, { useState } from 'react';
      import { createRoot } from 'react-dom/client';
      import { VoiceModeButton } from './components/subject-voice-dialog';
      import { TtsTestDialog } from './components/tts-test-dialog';
      import { LocalFetchInterceptor } from './components/local-fetch-interceptor';
      function Harness() {
        const [open, setOpen] = useState(false);
        const [active, setActive] = useState(false);
        return <><LocalFetchInterceptor /><VoiceModeButton active={active} label="Micrófono principal"
          onClick={() => { window.shortClicks++; setActive(!active); }} onLongPress={() => setOpen(true)} />
          <TtsTestDialog open={open} onOpenChange={setOpen} /></>;
      }
      createRoot(document.getElementById('root')).render(<Harness />);
    `, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife",
    define: { "process.env.NODE_ENV": '"production"' },
  }),
  readFile("app/globals.css", "utf8").then((css) => postcss([tailwind()]).process(css, { from: "app/globals.css" })),
])

async function setup(t, viewport = { width: 1000, height: 700 }) {
  const [bundle, css] = await assets
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport })
  await page.route("https://tts.test/", (route) => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }))
  await page.goto("https://tts.test/")
  await page.evaluate(() => {
    window.shortClicks = 0
    window.requests = []
    window.players = []
    window.revoked = []
    window.holdRequest = false
    window.blockPlayback = false
    window.fetch = async (url, options) => {
      const request = url instanceof Request ? url : new Request(new URL(url, window.location.origin), options)
      const body = await request.clone().text()
      window.requests.push({ url: request.url, body: body ? JSON.parse(body) : null, signal: request.signal })
      if (window.holdRequest) await new Promise((resolve) => { window.releaseRequest = resolve })
      if (window.failRequest) return Response.json({ error: "Sin créditos" }, { status: 502 })
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/mpeg" } })
    }
    URL.createObjectURL = () => `blob:test-${window.players.length}`
    URL.revokeObjectURL = (url) => window.revoked.push(url)
    window.Audio = class {
      constructor(src) { this.src = src; this.plays = 0; this.pauses = 0; window.players.push(this) }
      async play() { this.plays++; if (window.blockPlayback) throw new DOMException("Blocked", "NotAllowedError") }
      pause() { this.pauses++ }
      removeAttribute() { this.src = "" }
      load() {}
    }
  })
  await page.addStyleTag({ content: css.css })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.clock.install()
  return page
}

async function open(page) {
  const mic = page.locator('button[aria-label="Micrófono principal"]')
  await mic.dispatchEvent("pointerdown", { isPrimary: true, button: 0, clientX: 20, clientY: 20 })
  await page.clock.runFor(1050)
  await page.getByRole("dialog").waitFor()
  await mic.dispatchEvent("pointerup")
  await mic.dispatchEvent("click", { detail: 1 })
}

test("micrófono: clic corto, cancelar gesto y pulsación larga sin activar voz", async (t) => {
  const page = await setup(t)
  const mic = page.getByRole("button", { name: "Micrófono principal", exact: true })
  await mic.click()
  assert.equal(await page.evaluate(() => window.shortClicks), 1)
  assert.equal(await page.getByRole("dialog").count(), 0)
  for (const cancel of ["pointerup", "pointercancel", "pointerout", "pointermove"]) {
    await mic.dispatchEvent("pointerdown", { isPrimary: true, button: 0, clientX: 20, clientY: 20 })
    await mic.dispatchEvent(cancel, { clientX: 50, clientY: 50 })
    await page.clock.runFor(1100)
    assert.equal(await page.getByRole("dialog").count(), 0, cancel)
  }
  await open(page)
  assert.equal(await page.evaluate(() => window.shortClicks), 1)
  await page.keyboard.press("Escape")
  await page.clock.runFor(300)
  await mic.focus()
  await page.keyboard.press("Enter")
  assert.equal(await page.evaluate(() => window.shortClicks), 2)
})

for (const viewport of [{ width: 1000, height: 700 }, { width: 390, height: 640 }]) {
  test(`lista completa, selección única y texto visible (${viewport.width}px)`, async (t) => {
    const page = await setup(t, viewport)
    await open(page)
    const rows = page.locator("[data-tts-row]")
    assert.equal(await rows.count(), 8)
    assert.deepEqual(await page.getByRole("button", { expanded: true }).allTextContents(), ["tts-hd (OpenAI · Microsoft Azure)"])
    assert.equal(await page.getByRole("button", { name: "spacexai/grok-tts (xAI · Vercel AI Gateway)", exact: true }).count(), 1)
    assert.equal(await page.getByRole("radio", { checked: true }).count(), 1)
    assert.equal(await page.getByRole("radio").count(), 6)
    await page.getByRole("radio", { name: "nova", exact: true }).click()
    assert.equal(await page.getByRole("radio", { checked: true }).count(), 1)
    await page.getByRole("button", { name: "spacexai/grok-tts (xAI · Vercel AI Gateway)", exact: true }).click()
    assert.equal(await page.getByRole("radio", { name: "nova", exact: true }).count(), 0)
    assert.equal(await page.getByRole("radio", { name: "eve", checked: true }).count(), 1)
    const input = page.getByRole("textbox", { name: "Texto en español" })
    await input.fill("Probando español")
    const box = await input.boundingBox()
    assert.ok(box.y >= 0 && box.y + box.height <= viewport.height)
    const dimensions = await page.getByRole("dialog").evaluate((el) => ({ width: el.getBoundingClientRect().width, scrollWidth: el.scrollWidth }))
    assert.equal(dimensions.width, viewport.width)
    assert.ok(dimensions.scrollWidth <= viewport.width)
    await page.getByRole("radio", { name: "eve" }).focus()
    await page.keyboard.press("ArrowDown")
    assert.equal(await page.getByRole("radio", { name: "ara" }).evaluate((el) => el === document.activeElement), true)
    await page.keyboard.press("Space")
    assert.equal(await page.getByRole("radio", { name: "ara", checked: true }).count(), 1)
    await input.press("Enter")
    await page.waitForFunction(() => window.requests.length === 1)
    assert.deepEqual(await page.evaluate(() => window.requests[0].body), { modelId: "spacexai/grok-tts", voiceId: "ara", text: "Probando español" })
  })
}

test("Enter reproduce, conserva texto, evita duplicados y cancela respuestas obsoletas", async (t) => {
  const page = await setup(t)
  await open(page)
  const input = page.getByRole("textbox", { name: "Texto en español" })
  assert.equal(await page.evaluate(async () => (await fetch("/api/tts")).status), 501)
  assert.equal(await page.evaluate(() => window.requests.length), 0)
  await input.press("Enter")
  assert.equal(await page.evaluate(() => window.requests.length), 0)
  await input.fill("Hola, ¿cómo estás?")
  await input.press("Shift+Enter")
  assert.equal(await page.evaluate(() => window.requests.length), 0)
  const original = await input.inputValue()
  await input.press("Enter")
  await page.waitForFunction(() => window.players.length === 1)
  assert.equal(await input.inputValue(), original)
  assert.deepEqual(await page.evaluate(() => window.requests[0].body), { modelId: "tts-hd", voiceId: "alloy", text: original })
  assert.equal(await page.evaluate(() => window.players[0].plays), 1)
  await page.evaluate(() => { window.holdRequest = true })
  await input.press("Enter")
  await input.press("Enter")
  assert.equal(await page.evaluate(() => window.requests.length), 2)
  assert.equal(await page.evaluate(() => window.players[0].pauses), 1)
  await page.keyboard.press("Escape")
  assert.equal(await page.evaluate(() => window.requests[1].signal.aborted), true)
  await page.evaluate(() => { window.releaseRequest(); window.holdRequest = false })
  await page.clock.runFor(300)
  assert.equal(await page.evaluate(() => window.players.length), 1)
  await open(page)
  assert.equal(await input.inputValue(), original)
  await page.evaluate(() => { window.blockPlayback = true })
  await input.press("Enter")
  await page.getByRole("button", { name: "Reproducir", exact: true }).waitFor()
  await page.evaluate(() => { window.blockPlayback = false })
  await page.getByRole("button", { name: "Reproducir", exact: true }).click()
  assert.equal(await page.evaluate(() => window.players[1].plays), 2)
  await page.evaluate(() => { window.failRequest = true })
  await input.press("Enter")
  await page.getByRole("status").filter({ hasText: "Sin créditos" }).waitFor()
  assert.equal(await input.inputValue(), original)
})
