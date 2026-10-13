import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { chromium } from "@playwright/test"
import { createUIMessageStream, createUIMessageStreamResponse } from "ai"

const require = createRequire(import.meta.url)
const { PDFDocument } = require("../public/vendor/pdf-lib.min.js")
const pdf = await PDFDocument.create()
pdf.addPage([600, 800])
let bytes = await pdf.save()

test("PDF.js star generates from cached Datalab text; note drags, persists and reopens with Escape", async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  let generations = 0, transcriptions = 0
  const errors = []
  page.on("pageerror", error => errors.push(error.message))
  await page.route("https://explanation.test/**", async route => {
    const url = new URL(route.request().url())
    if (url.pathname === "/api/pdf-explanation") {
      const body = route.request().postDataJSON()
      assert.equal(body.transcription, "Una derivada mide el cambio de la función.")
      assert.equal(body.question, generations === 0 ? "¿Qué representa la derivada?" : "Explicalo")
      generations++
      assert.equal(body.messages[0].role, "user")
      const html = '<html><head></head><body><h1>Explicación</h1><button onclick="this.textContent=\'Paso 2\'">Siguiente</button></body></html>'
      const response = createUIMessageStreamResponse({ stream: createUIMessageStream({ execute: ({ writer }) => {
        writer.write({ type: "start", messageId: "explanation" })
        if (generations === 2) {
          writer.write({ type: "data-explanation", data: { html } })
        } else {
          writer.write({ type: "tool-input-start", toolCallId: "render", toolName: "renderExplanation" })
          writer.write({ type: "tool-input-available", toolCallId: "render", toolName: "renderExplanation", input: { html } })
          writer.write({ type: "tool-output-available", toolCallId: "render", output: { html } })
        }
        writer.write({ type: "finish", finishReason: "tool-calls" })
      } }) })
      return route.fulfill({ body: await response.text(), headers: Object.fromEntries(response.headers) })
    }
    if (url.pathname.includes("marker-transcribe")) { transcriptions++; return route.fulfill({ status: 500 }) }
    if (url.pathname === "/sample.pdf") return route.fulfill({ body: Buffer.from(bytes), contentType: "application/pdf" })
    try {
      const file = `public${decodeURIComponent(url.pathname)}`
      let body = await readFile(file)
      if (url.pathname.endsWith("viewer.html")) body = Buffer.from(body.toString().replace('<script src="viewer-custom.js"></script>', ""))
      const contentType = /\.(mjs|js)$/.test(file) ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".html") ? "text/html" : "application/octet-stream"
      return route.fulfill({ body, contentType })
    } catch { return route.fulfill({ status: 404 }) }
  })
  const initialize = async () => {
    await page.waitForFunction(() => window.PDFViewerApplication?.pdfViewer?.getPageView(0)?.annotationEditorLayer?.annotationEditorLayer, null, { timeout: 20_000 }).catch(async error => {
      console.log(await page.evaluate(() => ({ error: document.body.innerText.slice(-2000), initialized: !!window.PDFViewerApplication?.pdfDocument, pages: window.PDFViewerApplication?.pdfViewer?.pagesCount })), errors)
      throw error
    })
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory()
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await window.PDFViewerApplication.pdfDocument.getData())), b => b.toString(16).padStart(2, "0")).join("")
      let dir = root
      for (const segment of ["manifests", "subject-voice", "pdf", "datalab-balanced-json-v1", hash]) dir = await dir.getDirectoryHandle(segment, { create: true })
      const writer = await (await dir.getFileHandle("extraction.json", { create: true })).createWritable()
      await writer.write(JSON.stringify({ batches: [{ extraction: { failedPages: [], blocks: [{ page: 1, text: "Una derivada mide el cambio de la función." }] } }] }))
      await writer.close()
      window.initPdfExplanations({ app: window.PDFViewerApplication, query: { localWorkspace: true, workspaceFileId: "workspace://sample.pdf" }, ensureWorkspaceRootHandle: async () => root, inscreenApiFetch: fetch, showToast: () => {} })
    })
  }
  try {
    const url = "https://explanation.test/pdfjs/web/viewer.html?file=%2Fsample.pdf"
    await page.goto(url)
    await initialize()
    await page.locator("#pdfExplanationButton").click()
    assert.equal(await page.getByRole("menuitem", { name: "Procedimiento" }).isDisabled(), true)
    await page.getByRole("menuitem", { name: "Verlo", exact: true }).click()
    await page.getByText("Página lista · Enter para explicar", { exact: true }).waitFor()
    await page.locator("#pdf-explanation-question").fill("¿Qué representa la derivada?")
    await page.locator("#pdf-explanation-question").press("Shift+Enter")
    assert.equal(generations, 0)
    await page.locator("#pdf-explanation-question").press("Enter")
    await page.locator(".pdf-explanation-result iframe").waitFor()
    await page.frameLocator(".pdf-explanation-result iframe").getByRole("button", { name: "Siguiente" }).click()
    await page.keyboard.press("Escape")
    await page.locator(".pdf-explanation-overlay").waitFor({ state: "detached" })
    const note = page.locator(".pdf-explanation-text")
    await note.waitFor()
    const before = await note.boundingBox()
    await page.mouse.move(before.x + 20, before.y + 10)
    await page.mouse.down()
    await page.mouse.move(before.x + 100, before.y + 80, { steps: 8 })
    await page.mouse.up()
    assert.equal(await page.locator(".pdf-explanation-overlay").count(), 0)
    const after = await note.boundingBox()
    assert.ok(after.x > before.x + 50)
    assert.ok(after.y > before.y + 50)
    await note.click()
    await page.locator(".pdf-explanation-result iframe").waitFor()
    assert.equal(generations, 1)
    await page.getByRole("button", { name: "Cerrar · Esc" }).click()
    await page.reload()
    await initialize()
    await note.waitFor()
    const restored = await note.boundingBox()
    assert.ok(Math.abs(restored.x - after.x) < 3)
    assert.ok(Math.abs(restored.y - after.y) < 3)
    await note.click()
    await page.locator(".pdf-explanation-result iframe").waitFor()
    assert.equal(generations, 1)
    assert.equal(transcriptions, 0)
    await page.getByRole("button", { name: "Cerrar · Esc" }).click()
    await page.evaluate(() => { window.PDFViewerApplication.pdfViewer.annotationEditorMode = { mode: 3 } })
    await page.waitForFunction(() => window.PDFViewerApplication.pdfViewer.annotationEditorMode === 3)
    await page.evaluate(() => { window.PDFViewerApplication.pdfViewer.annotationEditorMode = { mode: 0 } })
    await page.waitForFunction(() => window.PDFViewerApplication.pdfViewer.annotationEditorMode === 0)
    await note.waitFor()
    bytes = Uint8Array.from(await page.evaluate(async () => Array.from(await window.PDFViewerApplication.pdfDocument.saveDocument())))
    await page.reload()
    await initialize()
    await note.waitFor()
    assert.equal(await note.count(), 1)
    await note.click()
    await page.locator(".pdf-explanation-result iframe").waitFor()
    assert.equal(generations, 1)
    await page.getByRole("button", { name: "Cerrar · Esc" }).click()
    // Remove Conjuntos' cache to verify the page transcription survives PDF autosave independently.
    await page.evaluate(async () => {
      const manifests = await (await navigator.storage.getDirectory()).getDirectoryHandle("manifests")
      await manifests.removeEntry("subject-voice", { recursive: true })
    })
    await page.locator("#pdfExplanationButton").click()
    await page.getByRole("menuitem", { name: "Verlo", exact: true }).click()
    await page.locator("#pdf-explanation-question").press("Enter")
    await page.locator(".pdf-explanation-result iframe").waitFor()
    assert.equal(generations, 2)
    assert.equal(transcriptions, 0)
    assert.deepEqual(errors, [])
  } finally { await browser.close() }
})

test("star starts Datalab before confirmation; Enter waits for that job and retries Gateway without transcribing again", async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  let transcriptions = 0, generations = 0
  let release
  const pending = new Promise(resolve => { release = resolve })
  await page.route("https://prepare.test/**", async route => {
    const url = new URL(route.request().url())
    if (url.pathname === "/api/inscreen/marker-transcribe") {
      transcriptions++
      await pending
      return route.fulfill({ json: { markdown: "Transcripción de la página actual." } })
    }
    if (url.pathname === "/api/pdf-explanation") {
      generations++
      const body = route.request().postDataJSON()
      assert.equal(body.question, "Explicalo")
      assert.equal(body.transcription, "Transcripción de la página actual.")
      if (generations === 1) return route.fulfill({ status: 429, json: { error: "AI Gateway alcanzó el límite de solicitudes (429)." } })
      const html = "<html><head></head><body>Explicación lista</body></html>"
      const response = createUIMessageStreamResponse({ stream: createUIMessageStream({ execute: ({ writer }) => {
        writer.write({ type: "start", messageId: "retry" })
        writer.write({ type: "tool-input-available", toolCallId: "render", toolName: "renderExplanation", input: { html } })
        writer.write({ type: "tool-output-available", toolCallId: "render", output: { html } })
        writer.write({ type: "finish", finishReason: "tool-calls" })
      } }) })
      return route.fulfill({ body: await response.text(), headers: Object.fromEntries(response.headers) })
    }
    if (url.pathname === "/sample.pdf") return route.fulfill({ body: Buffer.from(bytes), contentType: "application/pdf" })
    try {
      const file = `public${url.pathname}`
      let body = await readFile(file)
      if (file.endsWith("viewer.html")) body = Buffer.from(body.toString().replace('<script src="viewer-custom.js"></script>', ""))
      return route.fulfill({ body, contentType: /\.(mjs|js)$/.test(file) ? "text/javascript" : file.endsWith(".css") ? "text/css" : file.endsWith(".html") ? "text/html" : "application/octet-stream" })
    } catch { return route.fulfill({ status: 404 }) }
  })
  try {
    await page.goto("https://prepare.test/pdfjs/web/viewer.html?file=%2Fsample.pdf")
    await page.waitForFunction(() => window.PDFViewerApplication?.pdfViewer?.getPageView(0)?.annotationEditorLayer?.annotationEditorLayer, null, { timeout: 20_000 })
    await page.evaluate(() => window.initPdfExplanations({ app: window.PDFViewerApplication, query: {}, ensureWorkspaceRootHandle: async () => null, inscreenApiFetch: fetch, showToast: () => {} }))
    const transcriptionRequest = page.waitForRequest("**/api/inscreen/marker-transcribe")
    await page.locator("#pdfExplanationButton").click()
    await transcriptionRequest
    assert.equal(transcriptions, 1)
    assert.equal(generations, 0)
    await page.getByRole("menuitem", { name: "Verlo", exact: true }).click()
    await page.locator("#pdf-explanation-question").press("Enter")
    assert.equal(generations, 0)
    assert.equal(transcriptions, 1)
    release()
    await page.getByText("AI Gateway alcanzó el límite de solicitudes (429).", { exact: true }).waitFor()
    await page.locator("#pdf-explanation-question").press("Enter")
    await page.locator(".pdf-explanation-result iframe").waitFor()
    assert.equal(transcriptions, 1)
    assert.equal(generations, 2)
  } finally { release(); await browser.close() }
})
