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
      import { SubjectVoiceDialog } from './components/subject-voice-dialog';
      function Harness() {
        const [subject, setSubject] = useState(null);
        return <><button onClick={() => setSubject({id:'algebra',name:'Álgebra'})}>Abrir materia</button>
          <SubjectVoiceDialog subject={subject} onClose={() => setSubject(null)} /></>;
      }
      createRoot(document.getElementById('root')).render(<Harness />);
    `, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife",
    define: { "process.env.NODE_ENV": '"production"' },
  }),
  readFile("app/globals.css", "utf8").then((css) => postcss([tailwind()]).process(css, { from: "app/globals.css" })),
])

async function setup(t, { supported = true, configured = true, viewport } = {}) {
  const [bundle, css] = await assets
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: viewport ?? { width: 975, height: 429 } })
  await page.setContent('<div id="root"></div>')
  await page.addStyleTag({ content: css.css })
  await page.evaluate(({ supported, configured }) => {
    window.voiceRequests = []
    window.fetch = async (url, options) => {
      window.voiceRequests.push({ url, method: options?.method ?? "GET" })
      return new Response("{}", { status: configured ? 200 : 503 })
    }
    window.recognitions = []
    window.SpeechRecognition = undefined
    window.webkitSpeechRecognition = undefined
    if (supported) window.SpeechRecognition = class {
      constructor() { this.aborted = false; window.recognitions.push(this) }
      start() { this.onstart?.() }
      abort() { this.aborted = true }
    }
  }, { supported, configured })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  return page
}

test("dictado temporal, pausa, reanudación y Esc detienen el micrófono", async (t) => {
  const page = await setup(t)
  await page.getByRole("button", { name: "Abrir materia" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.waitFor()
  await dialog.evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished)) })
  assert.equal(await dialog.getByRole("heading", { name: "Álgebra" }).count(), 1)
  assert.equal(await dialog.locator("[data-subject-voice-canvas]").innerText(), "")
  assert.deepEqual(await dialog.boundingBox(), { x: 0, y: 0, width: 975, height: 429 })
  assert.equal(await dialog.evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(255, 255, 255)")
  await page.evaluate(() => {
    const recognition = window.recognitions.at(-1)
    recognition.onresult({ results: [{ isFinal: false, 0: { transcript: "repasar" } }] })
  })
  await page.getByText("repasar", { exact: true }).waitFor()
  await page.evaluate(() => {
    const recognition = window.recognitions.at(-1)
    const event = { results: [{ isFinal: true, 0: { transcript: "repasar matrices" } }] }
    recognition.onresult(event)
    recognition.onresult(event)
    window.lateResult = recognition.onresult
  })
  await page.getByText("repasar matrices", { exact: true }).waitFor()
  await dialog.getByRole("button", { name: "Pausar micrófono" }).click()
  assert.equal(await page.evaluate(() => window.recognitions.at(-1).aborted), true)
  await page.evaluate(() => window.lateResult({ results: [{ isFinal: true, 0: { transcript: "tardío" } }] }))
  assert.equal(await dialog.locator("[data-subject-voice-canvas]").innerText(), "repasar matrices")
  await dialog.getByRole("button", { name: "Activar micrófono" }).click()
  assert.equal(await page.evaluate(() => window.recognitions.length), 2)
  await page.keyboard.press("Escape")
  await dialog.waitFor({ state: "hidden" })
  assert.equal(await page.evaluate(() => window.recognitions.at(-1).aborted), true)
  await page.getByRole("button", { name: "Abrir materia" }).click()
  await dialog.waitFor()
  assert.equal(await dialog.locator("[data-subject-voice-canvas]").innerText(), "")
  assert.equal(await page.evaluate(() => window.voiceRequests.every((request) => request.method === "GET")), true)
})

test("permiso denegado muestra un error y permite reintentar sin duplicar capturas", async (t) => {
  const page = await setup(t)
  await page.getByRole("button", { name: "Abrir materia" }).click()
  await page.getByRole("dialog").waitFor()
  await page.evaluate(() => window.recognitions.at(-1).onerror({ error: "not-allowed" }))
  await page.getByText("Permití el acceso al micrófono y volvé a activarlo.").waitFor()
  assert.equal(await page.evaluate(() => window.recognitions.at(-1).aborted), true)
  await page.getByRole("button", { name: "Reintentar micrófono" }).click()
  await page.getByRole("button", { name: "Pausar micrófono" }).waitFor()
  assert.equal(await page.evaluate(() => window.recognitions.filter((recognition) => !recognition.aborted).length), 1)
})

test("modal móvil y navegador sin dictado siguen permitiendo salir con Esc", async (t) => {
  const page = await setup(t, { supported: false, configured: false, viewport: { width: 390, height: 844 } })
  await page.getByRole("button", { name: "Abrir materia" }).click()
  await page.getByText("Este navegador no admite dictado por voz. Probá con Chrome o Edge.").waitFor()
  await page.getByRole("dialog").evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished)) })
  assert.deepEqual(await page.getByRole("dialog").boundingBox(), { x: 0, y: 0, width: 390, height: 844 })
  await page.keyboard.press("Escape")
  await page.getByRole("dialog").waitFor({ state: "hidden" })
})
