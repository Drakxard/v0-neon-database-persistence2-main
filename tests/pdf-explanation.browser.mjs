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
      if (route.request().method() === "GET") return route.fulfill({ json: { provider: "azure", models: [{ id: "gpt-5-mini", name: "GPT-5 mini · Azure" }] } })
      const body = route.request().postDataJSON()
      assert.equal(body.model, "gpt-5-mini")
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
    await page.locator(".pdf-explanation-model-status").filter({ hasText: "GPT-5 mini · Azure" }).waitFor()
    assert.equal(await page.locator(".pdf-explanation-model-row").isVisible(), false)
    await page.getByText("Página lista · Enter para explicar", { exact: true }).waitFor()
    await page.locator("#pdf-explanation-question").fill("¿Qué representa la derivada?")
    await page.locator("#pdf-explanation-question").press("Shift+Enter")
    assert.equal(generations, 0)
    const successfulDownload = page.waitForEvent("download")
    await page.locator("#pdf-explanation-question").press("Enter")
    await page.locator(".pdf-explanation-result iframe").waitFor()
    const file = await successfulDownload
    assert.ok(file.suggestedFilename().includes("pagina-1-exito"))
    const downloadedHtml = await readFile(await file.path(), "utf8")
    assert.ok(downloadedHtml.includes("<h1>Explicación</h1>"))
    assert.ok(downloadedHtml.includes("mostrar-explicacion"))
    const assertFullpage = async () => {
      const viewport = page.viewportSize()
      const box = await page.locator('.pdf-explanation-result iframe').boundingBox()
      assert.equal(box.x, 0)
      assert.equal(box.y, 0)
      assert.equal(box.width, viewport.width)
      assert.equal(box.height, viewport.height)
    }
    await assertFullpage()
    await page.setViewportSize({ width: 375, height: 667 })
    await assertFullpage()
    await page.setViewportSize({ width: 1280, height: 720 })
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
    // The saved FreeText must not also be painted into the page canvas below
    // its interactive editor. Counting editors alone misses that duplicate.
    await page.waitForFunction(() => window.PDFViewerApplication.pdfViewer.getPageView(0).renderingState === 3)
    assert.equal(await page.evaluate(() => {
      const canvas = document.querySelector('.page .canvasWrapper canvas')
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      let purple = 0
      for (let i = 0; i < data.length; i += 4) if (data[i] > 70 && data[i] < 220 && data[i + 1] < 160 && data[i + 2] > 130) purple++
      return purple
    }), 0)
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
    await page.getByRole("button", { name: "Cerrar · Esc" }).click()
    const lastNote = page.locator(".pdf-explanation-text").last()
    const lastBox = await lastNote.boundingBox()
    await page.mouse.move(lastBox.x + 20, lastBox.y + 8)
    await page.mouse.down()
    await page.mouse.move(lastBox.x + 80, lastBox.y + 48, { steps: 6 })
    await page.mouse.up()
    await lastNote.locator('.editToolbar').waitFor({ state: 'visible' })
    assert.ok((await lastNote.getAttribute('class')).includes('selectedEditor'))
    await page.keyboard.press('Delete')
    await page.waitForFunction(() => document.querySelectorAll('.pdf-explanation-text').length === 1)
    await page.keyboard.press('Control+z')
    await page.waitForFunction(() => document.querySelectorAll('.pdf-explanation-text').length === 2)
    const undoBox = await lastNote.boundingBox()
    await page.mouse.move(undoBox.x + 20, undoBox.y + 8)
    await page.mouse.down()
    await page.mouse.move(undoBox.x + 50, undoBox.y + 28, { steps: 6 })
    await page.mouse.up()
    await lastNote.locator('.deleteButton').click()
    await page.waitForFunction(() => document.querySelectorAll('.pdf-explanation-text').length === 1)
    // Deleting a restored note must also remove its saved PDF annotation.
    await note.click()
    await page.getByRole("button", { name: "Cerrar · Esc" }).click()
    const remainingBox = await note.boundingBox()
    await page.mouse.move(remainingBox.x + 20, remainingBox.y + 8)
    await page.mouse.down()
    await page.mouse.move(remainingBox.x + 60, remainingBox.y + 28, { steps: 6 })
    await page.mouse.up()
    await page.keyboard.press('Delete')
    await note.waitFor({ state: 'detached' })
    await page.waitForFunction(async () => {
      const dir = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('manifests')).getDirectoryHandle('pdf-explanations')
      for await (const child of dir.values()) {
        const saved = JSON.parse(await (await (await child.getFileHandle('explanations.json')).getFile()).text())
        if (saved.entries.length === 2 && saved.entries.every(entry => entry.deleted)) return true
      }
      return false
    })
    // Reload the old PDF before autosave: the local deletion must suppress its
    // original annotation too, rather than resurrecting the interactive note.
    await page.reload()
    await initialize()
    await page.waitForFunction(() => [...(window.PDFViewerApplication.pdfDocument.annotationStorage.serializable.map?.values() || [])].some(annotation => annotation.deleted))
    await note.waitFor({ state: 'detached' })
    assert.equal(await note.count(), 0)
    bytes = Uint8Array.from(await page.evaluate(async () => Array.from(await window.PDFViewerApplication.pdfDocument.saveDocument())))
    await page.reload()
    await initialize()
    assert.equal(await note.count(), 0)
    assert.equal(await page.evaluate(async () => (await (await window.PDFViewerApplication.pdfDocument.getPage(1)).getAnnotations()).filter(a => a.subtype === 'FreeText').length), 0)
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
      if (route.request().method() === "GET") return route.fulfill({ json: { models: [{ id: "free/a" }, { id: "free/b" }] } })
      generations++
      const body = route.request().postDataJSON()
      assert.equal(body.model, generations === 1 ? "free/a" : "free/b")
      assert.equal(body.question, "Explicalo")
      assert.equal(body.transcription, "Transcripción de la página actual.")
      if (generations === 1) return route.fulfill({ status: 429, json: { error: "AI Gateway alcanzó el límite de solicitudes (429)." } })
      const html = "<html><head></head><body>Explicación lista</body></html>"
      const response = createUIMessageStreamResponse({ stream: createUIMessageStream({ execute: ({ writer }) => {
        writer.write({ type: "start", messageId: "retry" })
        // A tool-input error used to abort the browser before recovery arrived.
        writer.write({ type: "tool-input-error", toolCallId: "render", toolName: "renderExplanation", input: '{"html":"Incomplete', errorText: "JSON inválido" })
        writer.write({ type: "data-explanation-debug", data: { stage: "validacion-html-recuperacion", model: "free-test-model", text: html } })
        writer.write({ type: "data-explanation", data: { html } })
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
    await page.locator(".pdf-explanation-loading").waitFor({ state: "visible" })
    assert.equal(await page.locator("#pdf-explanation-model").isDisabled(), true)
    const failedDownload = page.waitForEvent("download")
    release()
    await page.getByText("AI Gateway alcanzó el límite de solicitudes (429).", { exact: true }).waitFor()
    const failure = await failedDownload
    assert.ok(failure.suggestedFilename().includes("pagina-1-fallo"))
    const failureHtml = await readFile(await failure.path(), "utf8")
    assert.ok(failureHtml.includes("429"))
    assert.ok(failureHtml.includes("respuesta-http"))
    assert.ok(failureHtml.includes("Transcripción de la página actual."))
    const retriedDownload = page.waitForEvent("download")
    await page.locator("#pdf-explanation-model").selectOption("free/b")
    await page.locator("#pdf-explanation-question").press("Enter")
    await page.locator(".pdf-explanation-result iframe").waitFor()
    const retry = await retriedDownload
    assert.ok(retry.suggestedFilename().includes("pagina-1-exito"))
    const retryHtml = await readFile(await retry.path(), "utf8")
    assert.ok(retryHtml.includes("tool-input-error"))
    assert.ok(retryHtml.includes("free-test-model"))
    assert.equal(transcriptions, 1)
    assert.equal(generations, 2)
  } finally { release(); await browser.close() }
})
