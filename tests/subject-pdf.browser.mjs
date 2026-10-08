import assert from "node:assert/strict"
import test from "node:test"
import { createRequire } from "node:module"
import { build } from "esbuild"
import { chromium } from "@playwright/test"

const require = createRequire(import.meta.url)
const { PDFDocument, StandardFonts, degrees } = require("../public/vendor/pdf-lib.min.js")
const pdfDocument = await PDFDocument.create()
const font = await pdfDocument.embedFont(StandardFonts.TimesRoman)
for (let i = 0; i < 2; i++) {
  const page = pdfDocument.addPage([600, 800])
  if (i === 1) page.setRotation(degrees(90))
  page.drawText("TEOREMA 7.2.2 Transformada de una derivada", { x: 40, y: 740, size: 14, font })
  page.drawText("La transformada de la derivada es sF(s) - f(0).", { x: 40, y: 690, size: 12, font })
  page.drawText("Aplique el teorema para resolver el ejercicio.", { x: 40, y: 600, size: 12, font })
}
const pdfBytes = Array.from(await pdfDocument.save())
const bundle = await build({
  stdin: { contents: `
    import React, { createRef } from 'react'; import { createRoot } from 'react-dom/client';
    import { SubjectVoiceImages } from './components/subject-voice-images';
    import { setReadyWorkspaceHandle } from './lib/local-workspace-client';
    import { prepareTheoryPdfs, searchTheoryPdfs } from './lib/client/subject-pdf-search';
    import { renderPdfFragment } from './lib/client/subject-pdf-crops';
    import { splitPdfBatches } from './lib/client/subject-pdf-files';
    setReadyWorkspaceHandle(window.workspaceRoot);
    window.prepareTheory = async (id='algebra', signal=new AbortController().signal) => prepareTheoryPdfs(id, signal, () => {});
    window.searchTheory = async (theory, query) => searchTheoryPdfs(theory, query, new AbortController().signal, () => {});
    window.renderFragment = async result => renderPdfFragment(result, new AbortController().signal, () => {});
    window.splitBatches = async file => { const batches = []; for await (const batch of splitPdfBatches(file, new AbortController().signal)) batches.push({pages:batch.pages,size:batch.file?.size,error:batch.error}); return batches; };
    const voiceRef = createRef();
    window.pdfEscape = () => voiceRef.current.escape();
    const root = createRoot(document.getElementById('root'));
    window.changePdfSubject = subjectId => root.render(<SubjectVoiceImages key={subjectId} subjectId={subjectId} ref={voiceRef} />);
    root.render(<SubjectVoiceImages key="algebra" subjectId="algebra" ref={voiceRef} />);
  `, resolveDir: process.cwd(), loader: "tsx" },
  bundle: true, write: false, platform: "browser", format: "iife",
  define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "local-pdf-fixture", setup(builder) {
    builder.onLoad({ filter: /local-workspace-data\.ts$/ }, () => ({ loader: "ts", contents: `
      export async function listLocalSubjectMaterialContainers() { return [{id:1,kind:'theory'}, {id:2,kind:'practice'}, {id:3,kind:'custom'}]; }
      export async function listLocalSubjectWeekNumbersWithContent() { return [8,7,6]; }
      export async function listLocalSubjectDayMaterials({subjectId,weekNumber}) { return window.materials.filter(m => m.subject_id===subjectId && m.week_number===weekNumber); }
      export async function getWorkspaceFile(id) { if (!window.pdfFiles.has(id)) throw new Error('PDF retirado'); return window.pdfFiles.get(id); }
    ` }));
  } }],
})

async function setup(t) {
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.route("https://pdf.test/", (route) => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }))
  await page.route("https://pdf.test/vendor/pdf-lib.min.js", (route) => route.fulfill({ path: "public/vendor/pdf-lib.min.js", contentType: "text/javascript" }))
  await page.route("https://pdf.test/pdfjs/build/pdf.worker.min.mjs", (route) => route.fulfill({ path: "public/pdfjs/build/pdf.worker.min.mjs", contentType: "text/javascript" }))
  await page.goto("https://pdf.test/")
  await page.evaluate(({ bytes }) => {
    window.workspaceFiles = new Map()
    const missing = () => new DOMException("Missing", "NotFoundError")
    const directory = (prefix = "") => ({
      queryPermission: async () => "granted",
      getDirectoryHandle: async (name, { create = false } = {}) => {
        const path = prefix + name + "/"
        if (!create && ![...window.workspaceFiles.keys()].some((key) => key.startsWith(path))) throw missing()
        return directory(path)
      },
      getFileHandle: async (name, { create = false } = {}) => {
        const path = prefix + name
        if (!create && !window.workspaceFiles.has(path)) throw missing()
        return {
          getFile: async () => {
            if (!window.workspaceFiles.has(path)) throw missing()
            return new File([window.workspaceFiles.get(path)], name)
          },
          createWritable: async () => {
            let content
            return {
              write: async (value) => { if (window.failWrites) throw new Error("Disco lleno"); content = typeof value === "string" ? new Blob([value]) : value },
              close: async () => window.workspaceFiles.set(path, content), abort: async () => {},
            }
          },
        }
      },
    })
    window.workspaceRoot = directory()
    const material = (id, week, container, fileId) => ({ id, subject_id: "algebra", week_number: week, container_id: container,
      file_name: "apuntes.pdf", drive_file_id: fileId, drive_mime_type: "application/pdf", updated_at: String(id) })
    window.materials = [material(1, 7, 1, "pdf-1"), material(2, 8, 2, "pdf-practice"), material(3, 8, 3, "pdf-custom"), material(4, 6, 1, "pdf-old")]
    window.makeMaterial = material
    window.pdfFiles = new Map(["pdf-1", "pdf-practice", "pdf-custom", "pdf-old"].map((id) => [id, new File([new Uint8Array(bytes)], "apuntes.pdf", { type: "application/pdf" })]))
    window.pdfRequests = []; window.jobs = new Map(); window.failClef = false
    const block = (id, type, html, bbox) => ({ id, block_type: type, html, bbox, children: [] })
    window.fixturePayload = { json: { block_type: "Document", children: [
      { id: "/page/0", block_type: "Page", bbox: [0, 0, 600, 800], children: [
        block("/page/0/SectionHeader/0", "SectionHeader", "<h2>TEOREMA 7.2.2 Transformada de una derivada</h2>", [40, 40, 360, 65]),
        block("/page/0/Text/1", "Text", "<p>La transformada de la derivada es sF(s)-f(0).</p>", [40, 95, 320, 115]),
        block("/page/0/SectionHeader/2", "SectionHeader", "<h2>Ejercicios</h2>", [40, 160, 360, 175]),
        block("/page/0/Text/3", "Text", "<p>Aplique el teorema para resolver el ejercicio.</p>", [40, 185, 360, 205]),
      ] },
      { id: "/page/1", block_type: "Page", bbox: [0, 0, 800, 600], children: [
        block("/page/1/SectionHeader/0", "SectionHeader", "<h2>Ejemplo desarrollado de una derivada</h2>", [100, 40, 130, 360]),
        block("/page/1/Text/1", "Text", "<p>La derivada del ejemplo se obtiene paso a paso.</p>", [150, 40, 175, 320]),
      ] },
    ] }, markdown: "Apuntes", metadata: { failed_pages: [] } }
    window.nativeFetch = window.fetch.bind(window)
    window.fetch = async (input, options = {}) => {
      const url = String(input)
      if (!url.startsWith("/api/")) return window.nativeFetch(input, options)
      window.pdfRequests.push({ url, method: options.method ?? "GET" })
      if (url === "/api/subject-voice/pdf-extraction") {
        const token = "job-" + window.jobs.size
        window.jobs.set(token, options.body.get('words') === 'true' ? window.wordPayload : window.fixturePayload)
        return Response.json({ token })
      }
      if (url.startsWith("/api/subject-voice/pdf-extraction?")) {
        const token = new URL(url, location.origin).searchParams.get("token")
        if (window.holdPoll) {
          await new Promise((resolve, reject) => {
            window.releasePoll = resolve
            options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })
          })
        }
        return Response.json({ status: "complete", payload: window.jobs.get(token) })
      }
      if (url === "/api/subject-voice/pdf-evaluate") {
        const { candidate } = JSON.parse(options.body)
        if (window.holdClef) await new Promise((resolve) => { window.releaseClef = resolve })
        if (window.failClef) return Response.json({ error: "Clef no disponible" }, { status: 503 })
        const accepted = !candidate.blocks[0].text.includes("Ejercicios")
        const partialIds = window.mixedPdf ? candidate.blocks.filter((b) => b.type === 'Text').map((b) => b.id) : []
        return Response.json({ id: candidate.id, accepted, blockIds: accepted ? candidate.blocks.map((b) => b.id).filter(id => !partialIds.includes(id)) : [], partialIds })
      }
      if (url === '/api/subject-voice/pdf-refine') {
        const { units } = JSON.parse(options.body)
        return Response.json({ ids: units.filter(u => !u.text.includes('Aplique')).map(u => u.id), uncertain: false })
      }
      return Response.json({})
    }
  }, { bytes: pdfBytes })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.waitForFunction(() => window.prepareTheory)
  await page.waitForFunction(() => window.workspaceFiles.size > 0)
  return page
}

test("prepara solo la última teoría, busca con globos y muestra recortes originales incluso con rotación", async (t) => {
  const page = await setup(t)
  await page.waitForFunction(() => [...window.workspaceFiles.keys()].some((path) => path.endsWith("extraction.json")))
  assert.equal(await page.locator("[data-voice-pdf-id]").count(), 0)
  await page.locator("[data-voice-search]").fill("teorema")
  await page.locator("[data-voice-pdf-id]").waitFor()
  assert.equal(await page.locator("[data-voice-pdf-id]").count(), 1)
  assert.match(await page.locator("[data-voice-pdf-id]").innerText(), /TEOREMA 7\.2\.2/)
  assert.match(await page.locator("[data-voice-bubbles]").innerText(), /Semana 7/)
  assert.equal(await page.evaluate(() => window.pdfRequests.filter((r) => r.method === "POST" && r.url.endsWith("pdf-extraction")).length), 1)
  await page.locator("[data-voice-pdf-id]").click()
  await page.locator("[data-voice-pdf-fragment] img").first().waitFor()
  assert.equal(await page.locator("[data-voice-pdf-fragment] img").count(), 2)
  assert.equal(await page.locator("[data-voice-pdf-fragment] img").first().evaluate((image) => image.naturalWidth < 800 && image.naturalHeight < 200), true)
  assert.equal(await page.evaluate(() => window.pdfEscape()), true)
  await page.locator("[data-voice-search]").waitFor()
  assert.equal(await page.locator("[data-voice-search]").inputValue(), "teorema")
  await page.locator("[data-voice-search]").fill("derivada")
  await page.waitForFunction(() => document.querySelectorAll("[data-voice-pdf-id]").length === 2)
  await page.locator("[data-voice-pdf-id]").last().click()
  await page.locator("[data-voice-pdf-fragment] img").first().waitFor()
  assert.match(await page.locator("[data-voice-pdf-fragment]").innerText(), /Página 2/)
})

test("repetir consulta no llama servicios; PDF agregado, reemplazado y retirado actualiza solo lo necesario", async (t) => {
  const page = await setup(t)
  const first = await page.evaluate(async () => {
    const theory = await window.prepareTheory()
    const result = await window.searchTheory(theory, "TEOREMA")
    return { theory, result, calls: window.pdfRequests.length }
  })
  assert.equal(first.theory.week, 7); assert.equal(first.theory.files.length, 1); assert.equal(first.result.results.length, 1)
  const repeated = await page.evaluate(async () => {
    const theory = await window.prepareTheory(); await window.searchTheory(theory, "teorema")
    return window.pdfRequests.length
  })
  assert.equal(repeated, first.calls)
  await page.evaluate(() => {
    // Different bytes create a new document fingerprint while the original retains its cache.
    const file = window.pdfFiles.get("pdf-1")
    window.pdfFiles.set("pdf-new", new File([file, "\n%new"], "nuevo.pdf", { type: "application/pdf" }))
    window.materials.push(window.makeMaterial(5, 7, 1, "pdf-new"))
  })
  const added = await page.evaluate(async () => {
    const before = window.pdfRequests.length, theory = await window.prepareTheory()
    await window.searchTheory(theory, "teorema")
    return { files: theory.files.length, requests: window.pdfRequests.slice(before) }
  })
  assert.equal(added.files, 2)
  assert.equal(added.requests.filter((r) => r.method === "POST" && r.url.endsWith("pdf-extraction")).length, 1)
  await page.evaluate(() => { window.materials = window.materials.filter((m) => m.id !== 1) })
  const removed = await page.evaluate(async () => window.searchTheory(await window.prepareTheory(), "teorema"))
  assert.equal(removed.results.length, 1)
  assert.equal(removed.results[0].fileId, "pdf-new")
  await page.evaluate(() => {
    const file = window.pdfFiles.get("pdf-new")
    window.pdfFiles.set("pdf-new", new File([file, "\n%replacement"], "nuevo.pdf", { type: "application/pdf" }))
  })
  const replaced = await page.evaluate(async () => window.searchTheory(await window.prepareTheory(), "teorema"))
  assert.notEqual(replaced.results[0].hash, removed.results[0].hash)
})

test("fallas de Clef se muestran y el reintento conserva la extracción", async (t) => {
  const page = await setup(t)
  await page.evaluate(() => { window.failClef = true })
  await page.locator("[data-voice-search]").fill("teorema")
  await page.getByText("apuntes.pdf: Clef no disponible", { exact: true }).waitFor()
  assert.equal(await page.getByText("Sin coincidencias", { exact: true }).count(), 0)
  assert.equal(await page.locator("[data-voice-pdf-id]").count(), 0)
  await page.evaluate(() => { window.failClef = false })
  await page.getByRole("button", { name: "Reintentar PDF" }).click()
  await page.locator("[data-voice-pdf-id]").waitFor()
  assert.equal(await page.evaluate(() => window.pdfRequests.filter((r) => r.method === "POST" && r.url.endsWith("pdf-extraction")).length), 1)
})

test("guarda un trabajo pendiente y lo retoma sin reenviar el PDF", async (t) => {
  const page = await setup(t)
  await page.evaluate(async () => { await window.prepareTheory(); window.holdPoll = true })
  await page.evaluate(() => {
    const file = window.pdfFiles.get("pdf-1")
    window.pdfFiles.set("pdf-pending", new File([file, "\n%pending"], "pendiente.pdf", { type: "application/pdf" }))
    window.materials = [window.makeMaterial(6, 7, 1, "pdf-pending")]
    window.pendingController = new AbortController()
    window.pendingPreparation = window.prepareTheory('algebra', window.pendingController.signal).catch(error => ({aborted: error.name === 'AbortError'}))
  })
  await page.waitForFunction(() => window.releasePoll)
  const jobsBefore = await page.evaluate(() => window.jobs.size)
  assert.equal(await page.evaluate(async () => (await Promise.all([...window.workspaceFiles.entries()].filter(([path]) => path.endsWith("extraction.json")).map(async ([, blob]) => JSON.parse(await blob.text())))).some((state) => state.batches.some((batch) => batch.token))), true)
  assert.equal(await page.evaluate(async () => {
    window.pendingController.abort()
    return (await window.pendingPreparation).aborted
  }), true)
  await page.evaluate(async () => { window.holdPoll = false; await window.prepareTheory() })
  assert.equal(await page.evaluate(() => window.jobs.size), jobsBefore)
})

test("bloque mixto usa coordenadas por palabra y conserva el recorte y el filtro en caché", async (t) => {
  const page = await setup(t)
  await page.evaluate(async () => {
    await window.prepareTheory()
    window.mixedPdf = true
    const file = window.pdfFiles.get('pdf-1')
    window.pdfFiles.set('pdf-mixed', new File([file, '\n%mixed'], 'mixto.pdf', { type:'application/pdf' }))
    window.materials = [window.makeMaterial(7, 7, 1, 'pdf-mixed')]
    window.fixturePayload = { json: { block_type:'Document', children:[{
      id:'/page/0', block_type:'Page', bbox:[0,0,600,800], children:[
        {id:'/page/0/SectionHeader/0',block_type:'SectionHeader',bbox:[40,40,360,65],html:'<h2>TEOREMA 7.2.2 Transformada de una derivada</h2>'},
        {id:'/page/0/Text/1',block_type:'Text',bbox:[40,95,360,205],html:'<p>La transformada de la derivada es sF(s)-f(0). Aplique el teorema en el ejercicio.</p>'},
      ]
    }] }, metadata:{failed_pages:[]} }
    window.wordPayload = { json: { block_type:'Document', children:[{
      id:'/page/0',block_type:'Page',bbox:[0,0,600,800],children:[
        {id:'/page/0/Text/1',block_type:'Text',bbox:[40,95,360,205],html:
          '<p><span data-bbox="40 95 52 115">La</span> <span data-bbox="56 95 120 115">transformada</span> <span data-bbox="125 95 320 115">de la derivada es sF(s)-f(0).</span></p>' +
          '<p><span data-bbox="40 185 360 205">Aplique el teorema en el ejercicio.</span></p>'},
      ]
    }] }, metadata:{failed_pages:[]} }
  })
  const first = await page.evaluate(async () => {
    const result = (await window.searchTheory(await window.prepareTheory(), 'teorema')).results[0]
    const fragment = await window.renderFragment(result)
    const dimensions = await Promise.all(fragment.images.map(async ({url}) => {
      const image = new Image(); image.src=url; await image.decode()
      return {width:image.naturalWidth,height:image.naturalHeight}
    }))
    fragment.images.forEach(({url})=>URL.revokeObjectURL(url))
    window.mixedResult = result
    return {dimensions,warnings:fragment.warnings,calls:window.pdfRequests.length}
  })
  assert.equal(first.dimensions.length,2)
  assert.equal(first.dimensions[1].height<60,true)
  assert.deepEqual(first.warnings,[])
  const second = await page.evaluate(async () => {
    const fragment = await window.renderFragment(window.mixedResult)
    fragment.images.forEach(({url})=>URL.revokeObjectURL(url))
    return window.pdfRequests.length
  })
  assert.equal(second,first.calls)
})

test("respuestas tardías no mezclan consultas ni materias", async (t) => {
  const page = await setup(t)
  await page.evaluate(async () => { await window.prepareTheory(); window.holdClef = true })
  await page.locator('[data-voice-search]').fill('teorema')
  await page.waitForFunction(() => window.releaseClef)
  await page.locator('[data-voice-search]').fill('palabra inexistente')
  await page.getByText('Sin coincidencias',{exact:true}).waitFor()
  await page.evaluate(() => { window.holdClef = false; window.releaseClef() })
  await page.waitForFunction(async () => (await Promise.all([...window.workspaceFiles].filter(([path])=>path.endsWith('.json')).map(async ([,blob])=>blob.text()))).some(text=>text.includes('"query":"teorema"')))
  assert.equal(await page.locator('[data-voice-pdf-id]').count(),0)
  await page.locator('[data-voice-search]').fill('teorema')
  await page.locator('[data-voice-pdf-id]').waitFor()
  await page.evaluate(()=>window.changePdfSubject('fisica'))
  await page.waitForFunction(()=>document.querySelector('[data-voice-search]')?.value==='')
  await page.locator('[data-voice-search]').fill('teorema')
  await page.getByText('Sin coincidencias',{exact:true}).waitFor()
  assert.equal(await page.locator('[data-voice-pdf-id]').count(),0)
})

test("divide documentos largos en lotes de diez páginas preservando las páginas originales", async (t) => {
  const page = await setup(t)
  const document = await PDFDocument.create()
  for (let i=0;i<23;i++) document.addPage([600,800])
  const bytes = Array.from(await document.save())
  const batches = await page.evaluate(async bytes => window.splitBatches(new File([new Uint8Array(bytes)],'largo.pdf',{type:'application/pdf'})),bytes)
  assert.deepEqual(batches.map(b=>b.pages.length),[10,10,3])
  assert.deepEqual(batches.flatMap(b=>b.pages),Array.from({length:23},(_,i)=>i+1))
  assert.equal(batches.every(b=>b.size<=3*1024*1024),true)
})
