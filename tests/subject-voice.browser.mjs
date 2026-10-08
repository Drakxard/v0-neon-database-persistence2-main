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
      import { setReadyWorkspaceHandle } from './lib/local-workspace-client';
      setReadyWorkspaceHandle(window.workspaceRoot);
      function Harness() {
        const [subject, setSubject] = useState(null);
        window.openVoiceSubject = (id, name) => setSubject({ id, name });
        return <><button onClick={() => setSubject({id:'algebra',name:'Álgebra'})}>Abrir materia</button>
          <SubjectVoiceDialog subject={subject} onClose={() => setSubject(null)} /></>;
      }
      createRoot(document.getElementById('root')).render(<Harness />);
    `, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "empty-theory-workspace", setup(builder) {
      // This harness covers manually uploaded images; PDF behavior has a dedicated workspace harness.
      builder.onLoad({ filter: /local-workspace-data\.ts$/ }, () => ({ loader: "ts", contents: `
        export async function listLocalSubjectMaterialContainers() { return []; }
        export async function listLocalSubjectWeekNumbersWithContent() { return []; }
        export async function listLocalSubjectDayMaterials() { return []; }
        export async function getWorkspaceFile() { throw new Error('No PDFs in this harness'); }
      ` }));
    } }],
  }),
  readFile("app/globals.css", "utf8").then((css) => postcss([tailwind()]).process(css, { from: "app/globals.css" })),
])

async function setup(t, { supported = true, configured = true, viewport } = {}) {
  const [bundle, css] = await assets
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: viewport ?? { width: 975, height: 429 } })
  await page.route("https://voice.test/", (route) => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }))
  await page.route("https://voice.test/fonts/virgil/Virgil.woff2", (route) => route.fulfill({ path: "public/fonts/virgil/Virgil.woff2", contentType: "font/woff2" }))
  await page.goto("https://voice.test/")
  await page.addInitScript(({ supported, configured }) => {
    window.workspaceFiles = new Map(JSON.parse(sessionStorage.getItem("test-workspace") ?? "[]").map(([path, bytes]) => [path, new Blob([new Uint8Array(bytes)])]))
    window.failWorkspaceWrites = false
    window.workspacePermission = "granted"
    const missing = () => new DOMException("Missing", "NotFoundError")
    const directory = (prefix = "") => ({
      queryPermission: async () => window.workspacePermission,
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
              write: async (value) => {
                if (window.holdWorkspaceWrites) {
                  window.writeStarted = true
                  await new Promise((resolve) => { window.releaseWorkspaceWrite = resolve })
                }
                if (window.failWorkspaceWrites || window.failWritePath === path || (window.failImageName && value instanceof File && value.name === window.failImageName)) throw new Error("Disco lleno")
                content = value
              },
              close: async () => {
                window.workspaceFiles.set(path, content)
                sessionStorage.setItem("test-workspace", JSON.stringify(await Promise.all([...window.workspaceFiles].map(async ([key, blob]) => [key, Array.from(new Uint8Array(await blob.arrayBuffer()))]))))
              },
              abort: async () => {},
            }
          },
        }
      },
    })
    window.workspaceRoot = directory()
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
  await page.reload()
  await page.addStyleTag({ content: css.css })
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
  assert.equal(await dialog.locator("[data-voice-search]").inputValue(), "")
  assert.deepEqual(await dialog.boundingBox(), { x: 0, y: 0, width: 975, height: 429 })
  assert.equal(await dialog.evaluate((element) => getComputedStyle(element).backgroundColor), "rgb(255, 255, 255)")
  await page.evaluate(() => {
    const recognition = window.recognitions.at(-1)
    recognition.onresult({ results: [{ isFinal: false, 0: { transcript: "repasar" } }] })
  })
  await page.waitForFunction(() => document.querySelector("[data-voice-search]")?.value === "repasar")
  await page.evaluate(() => {
    const recognition = window.recognitions.at(-1)
    const event = { results: [{ isFinal: true, 0: { transcript: "repasar matrices" } }] }
    recognition.onresult(event)
    recognition.onresult(event)
    window.lateResult = recognition.onresult
  })
  await page.waitForFunction(() => document.querySelector("[data-voice-search]")?.value === "repasar matrices")
  const search = dialog.locator('[data-voice-search]')
  await search.fill('repasar matrices 7')
  await page.evaluate(() => window.recognitions.at(-1).onresult({ results: [
    {isFinal:true,0:{transcript:'repasar matrices'}}, {isFinal:false,0:{transcript:'inversas'}},
  ] }))
  await page.waitForFunction(() => document.querySelector('[data-voice-search]')?.value === 'repasar matrices 7 inversas')
  await search.fill('repasar matrices 7 inversa')
  await page.evaluate(() => window.recognitions.at(-1).onresult({ results: [
    {isFinal:true,0:{transcript:'repasar matrices'}}, {isFinal:true,0:{transcript:'inversas'}},
  ] }))
  assert.equal(await search.inputValue(), 'repasar matrices 7 inversa')
  assert.equal(await dialog.locator('[data-subject-voice-canvas]').count(), 0)
  await dialog.getByRole("button", { name: "Pausar micrófono" }).click()
  assert.equal(await page.evaluate(() => window.recognitions.at(-1).aborted), true)
  await page.evaluate(() => window.lateResult({ results: [{ isFinal: true, 0: { transcript: "tardío" } }] }))
  assert.equal(await dialog.locator("[data-voice-search]").inputValue(), "repasar matrices 7 inversa")
  await dialog.getByRole("button", { name: "Activar micrófono" }).click()
  assert.equal(await page.evaluate(() => window.recognitions.length), 2)
  await page.keyboard.press("Escape")
  await page.keyboard.press("Escape")
  await dialog.waitFor({ state: "hidden" })
  assert.equal(await page.evaluate(() => window.recognitions.at(-1).aborted), true)
  await page.getByRole("button", { name: "Abrir materia" }).click()
  await dialog.waitFor()
  assert.equal(await dialog.locator("[data-voice-search]").inputValue(), "")
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

const imageBuffer = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDZkAAAAASUVORK5CYII=", "base64")
function imageFile(name = "Teo existencia.png") { return { name, mimeType: "image/png", buffer: imageBuffer } }
async function upload(page, files) {
  await page.locator('input[type="file"]').setInputFiles(files)
}
async function createGroup(page, name, files = [imageFile()]) {
  await upload(page, files)
  await page.getByLabel("Nombre del conjunto", { exact: true }).fill(name)
  await page.getByRole("button", { name: "Crear conjunto", exact: true }).click()
  await page.getByRole("button", { name: new RegExp(`${name}, \\d+ imágenes`) }).waitFor()
}
async function dropFiles(page, selector, files) {
  await page.locator(selector).evaluate((element, files) => {
    const transfer = new DataTransfer()
    for (const file of files) {
      const bytes = Uint8Array.from(atob(file.base64), (character) => character.charCodeAt(0))
      transfer.items.add(new File([bytes], file.name, { type: "image/png" }))
    }
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }))
  }, files.map((file) => ({ name: file.name, base64: file.buffer.toString("base64") })))
}

test("conjuntos: color, nombres repetidos, visor, Escape y recuperación por materia", async (t) => {
  const page = await setup(t)
  await page.getByRole("button", { name: "Abrir materia" }).click()
  await page.getByText("O tocá aquí para seleccionarlas").waitFor()
  await upload(page, [imageFile("Teorema.orden.png"), imageFile("Teorema.orden.png")])
  await page.getByLabel("Nombre del conjunto", { exact: true }).fill("Conceptos")
  await page.getByText("Azul", { exact: true }).click()
  await page.getByRole("button", { name: "Crear conjunto", exact: true }).click()
  const group = page.getByRole("button", { name: "Conceptos, 2 imágenes" })
  await group.waitFor()
  const bubbleBounds = await group.boundingBox()
  const areaBounds = await page.locator("[data-voice-bubbles]").boundingBox()
  assert.equal(bubbleBounds.y >= areaBounds.y && bubbleBounds.y + bubbleBounds.height <= areaBounds.y + areaBounds.height + 1, true)
  await page.evaluate(() => document.fonts.ready)
  assert.match(await page.getByRole("dialog").evaluate((element) => getComputedStyle(element).fontFamily), /SubjectVoiceVirgil/)
  if (process.env.VOICE_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.VOICE_SCREENSHOT_DIR}/subject-voice-bubbles-desktop.png` })
  assert.equal(await group.locator('svg path[fill="#a5d8ff"]').count() > 0, true)
  await group.click()
  assert.equal(await page.getByRole("button", { name: "Teorema.orden", exact: true }).count(), 2)
  await page.getByRole("button", { name: "Teorema.orden", exact: true }).first().click()
  await page.getByRole("img", { name: "Teorema.orden.png" }).waitFor()
  assert.equal(await page.getByRole("img").evaluate((element) => getComputedStyle(element).objectFit), "contain")
  await page.keyboard.press("Escape")
  assert.equal(await page.getByRole("img").count(), 0)
  assert.equal(await page.getByRole("dialog").count(), 1)
  await page.keyboard.press("Escape")
  await group.waitFor()
  await page.keyboard.press("Escape")
  await page.getByRole("dialog").waitFor({ state: "hidden" })
  // Reload the document and reconnect the same simulated folder, including its binary files.
  const [bundle, css] = await assets
  await page.reload()
  await page.addStyleTag({ content: css.css })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.getByRole("button", { name: "Abrir materia" }).click()
  await group.waitFor()
  await page.evaluate(() => window.openVoiceSubject("fisica", "Física"))
  await page.getByText("O tocá aquí para seleccionarlas").waitFor()
  assert.equal(await page.getByRole("button", { name: "Conceptos, 2 imágenes" }).count(), 0)
  await page.evaluate(() => window.openVoiceSubject("algebra", "Álgebra"))
  await group.waitFor()
  const manifest = await page.evaluate(async () => JSON.parse(await window.workspaceFiles.get("manifests/subject-voice/algebra/workspace.json").text()))
  assert.equal(manifest.groups[0].images.length, 2)
  assert.notEqual(manifest.groups[0].images[0].path, manifest.groups[0].images[1].path)
})

test("arrastre dirigido agrega al globo; espacio blanco crea conjuntos también desde su interior", async (t) => {
  const page = await setup(t)
  await page.getByRole("button", { name: "Abrir materia" }).click()
  await page.getByText("O tocá aquí para seleccionarlas").waitFor()
  await createGroup(page, "Conceptos")
  await dropFiles(page, 'button[aria-label="Conceptos, 1 imágenes"]', [imageFile("Definición.png")])
  await page.getByRole("button", { name: "Conceptos, 2 imágenes" }).waitFor()
  assert.equal(await page.getByRole("form", { name: "Crear conjunto" }).count(), 0)
  await page.getByRole("button", { name: "Conceptos, 2 imágenes" }).click()
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Conceptos, 2 imágenes" }).waitFor()
  await dropFiles(page, 'button[aria-label="Conceptos, 2 imágenes"]', [imageFile("Wronskiano.png")])
  await page.getByRole("button", { name: "Conceptos, 3 imágenes" }).click()
  await page.getByRole("button", { name: "Wronskiano", exact: true }).waitFor()
  await dropFiles(page, '[data-subject-voice-images]', [imageFile("Tema nuevo.png")])
  await page.getByLabel("Nombre del conjunto", { exact: true }).fill("Otro")
  await page.getByRole("button", { name: "Crear conjunto", exact: true }).click()
  await page.getByRole("button", { name: "Otro, 1 imágenes" }).waitFor()
  await page.getByRole("button", { name: "Conceptos, 3 imágenes" }).waitFor()
})

test("cancelar, rechazar archivos inválidos y reintentar escrituras sin inflar el conteo", async (t) => {
  const page = await setup(t)
  await page.getByRole("button", { name: "Abrir materia" }).click()
  await page.getByText("O tocá aquí para seleccionarlas").waitFor()
  await upload(page, [imageFile()])
  await page.getByRole("button", { name: "Cancelar", exact: true }).click()
  assert.equal(await page.evaluate(() => window.workspaceFiles.size), 0)
  await upload(page, [imageFile()])
  await page.getByLabel("Nombre del conjunto", { exact: true }).waitFor()
  await page.keyboard.press("Escape")
  assert.equal(await page.getByRole("form", { name: "Crear conjunto" }).count(), 0)
  assert.equal(await page.getByRole("dialog").count(), 1)
  await upload(page, [imageFile(), { name: "roto.png", mimeType: "image/png", buffer: Buffer.from("not an image") }])
  await page.getByText("roto.png: no es una imagen decodificable.").waitFor()
  await page.getByLabel("Nombre del conjunto", { exact: true }).fill("Conceptos")
  await page.evaluate(() => { window.failWorkspaceWrites = true })
  await page.getByRole("button", { name: "Crear conjunto", exact: true }).click()
  await page.getByRole("button", { name: "Reintentar guardado" }).waitFor()
  assert.equal(await page.getByRole("button", { name: "Conceptos, 1 imágenes" }).count(), 0)
  await page.evaluate(() => { window.failWorkspaceWrites = false })
  await page.getByRole("button", { name: "Reintentar guardado" }).click()
  await page.getByRole("button", { name: "Conceptos, 1 imágenes" }).waitFor()
})

test("manifiesto ilegible y permiso denegado no se interpretan como una materia vacía", async (t) => {
  const page = await setup(t)
  await page.evaluate(() => {
    window.workspaceFiles.set("manifests/subject-voice/algebra/workspace.json", new Blob(["{roto"]))
  })
  await page.getByRole("button", { name: "Abrir materia" }).click()
  await page.getByRole("button", { name: "Reintentar carga" }).waitFor()
  assert.equal(await page.getByText("O tocá aquí para seleccionarlas").count(), 0)
  await page.evaluate(() => {
    window.workspaceFiles.delete("manifests/subject-voice/algebra/workspace.json")
    window.workspacePermission = "denied"
  })
  await page.getByRole("button", { name: "Reintentar carga" }).click()
  await page.getByText("Volvé a autorizar la carpeta local de la app para leer y guardar imágenes.").waitFor()
  await page.evaluate(() => { window.workspacePermission = "granted" })
  await page.getByRole("button", { name: "Reintentar carga" }).click()
  await page.getByText("O tocá aquí para seleccionarlas").waitFor()
})

test("fallos parciales guardan y cuentan solo los archivos correctos; reintentar agrega los restantes", async (t) => {
  const page = await setup(t)
  await page.getByRole("button", { name: "Abrir materia" }).click()
  await page.getByText("O tocá aquí para seleccionarlas").waitFor()
  await page.evaluate(() => { window.failImageName = "Pendiente.png" })
  await createGroup(page, "Conceptos", [imageFile("Guardada.png"), imageFile("Pendiente.png")])
  await page.getByRole("button", { name: "Conceptos, 1 imágenes" }).waitFor()
  await page.evaluate(() => { window.failImageName = null })
  await page.getByRole("button", { name: "Reintentar guardado" }).click()
  await page.getByRole("button", { name: "Conceptos, 2 imágenes" }).waitFor()
  assert.equal(await page.getByRole("alert").count(), 0)
})

test("fallo al escribir manifiesto conserva el conjunto anterior hasta poder reintentar", async (t) => {
  const page = await setup(t)
  await page.getByRole("button", { name: "Abrir materia" }).click()
  await page.getByText("O tocá aquí para seleccionarlas").waitFor()
  await createGroup(page, "Conceptos")
  await page.evaluate(() => { window.failWritePath = "manifests/subject-voice/algebra/workspace.json" })
  await dropFiles(page, 'button[aria-label="Conceptos, 1 imágenes"]', [imageFile("Otro.png")])
  await page.getByRole("button", { name: "Reintentar guardado" }).waitFor()
  await page.getByRole("button", { name: "Conceptos, 1 imágenes" }).waitFor()
  await page.evaluate(() => { window.failWritePath = null })
  await page.getByRole("button", { name: "Reintentar guardado" }).click()
  await page.getByRole("button", { name: "Conceptos, 2 imágenes" }).waitFor()
})

test("móvil: selector, nombres largos, desplazamiento y apertura mediante teclado", async (t) => {
  const page = await setup(t, { viewport: { width: 390, height: 844 } })
  await page.getByRole("button", { name: "Abrir materia" }).click()
  await page.getByText("O tocá aquí para seleccionarlas").waitFor()
  const files = Array.from({ length: 16 }, (_, index) => imageFile(`Teorema muy largo de existencia y unicidad número ${index}.png`))
  await createGroup(page, "Conceptos", files)
  await page.getByRole("button", { name: "Conceptos, 16 imágenes" }).click()
  await page.getByRole("button", { name: /Teorema muy largo/ }).first().waitFor()
  const bounds = await page.locator("[data-voice-bubbles]").evaluate((element) => ({ scrollHeight: element.scrollHeight, height: element.clientHeight, width: element.clientWidth, scrollWidth: element.scrollWidth }))
  assert.equal(bounds.scrollHeight > bounds.height, true)
  assert.equal(bounds.scrollWidth, bounds.width)
  await page.evaluate(() => document.fonts.ready)
  if (process.env.VOICE_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.VOICE_SCREENSHOT_DIR}/subject-voice-bubbles-mobile.png` })
  const image = page.getByRole("button", { name: /Teorema muy largo/ }).last()
  await image.focus()
  await page.keyboard.press("Enter")
  await page.getByRole("img").waitFor()
  await page.keyboard.press("Backspace")
  await page.getByRole("button", { name: /Teorema muy largo/ }).first().waitFor()
  await page.keyboard.press("Backspace")
  await page.getByRole("button", { name: "Conceptos, 16 imágenes" }).waitFor()
})

async function openMatter(page) {
  await page.getByRole("button", { name: "Abrir materia" }).click()
  await page.getByText("O tocá aquí para seleccionarlas").waitFor()
}
async function manifest(page) {
  return page.evaluate(async () => JSON.parse(await window.workspaceFiles.get("manifests/subject-voice/algebra/workspace.json").text()))
}
async function reloadHarness(page) {
  const [bundle, css] = await assets
  await page.reload()
  await page.addStyleTag({ content: css.css })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.getByRole("button", { name: "Abrir materia" }).click()
}

test("búsqueda global temporal, visor sin nombre ni controles y regreso a la vista de origen", async (t) => {
  const page = await setup(t)
  await openMatter(page)
  await createGroup(page, "Conceptos", [imageFile("Teo existencia.png"), imageFile("Modelo lineal.png")])
  await createGroup(page, "Otros", [imageFile("Modelo mezclas.png"), imageFile("Definición ED.png")])
  await page.getByRole("button", { name: "Conceptos, 2 imágenes" }).click()
  await page.keyboard.type("modelos")
  await page.getByRole("button", { name: "Modelo mezclas", exact: true }).waitFor()
  assert.equal(await page.getByRole("textbox", { name: "Buscar imágenes" }).inputValue(), "modelos")
  assert.equal(await page.locator("[data-voice-image-id]").count(), 2)
  assert.equal(await page.getByRole("button", { name: /Volver|Ver conjuntos|Agregar imágenes|Cerrar materia/ }).count(), 0)
  await page.getByRole("button", { name: "Modelo mezclas", exact: true }).click()
  await page.getByRole("img", { name: "Modelo mezclas.png" }).waitFor()
  assert.equal(await page.getByText("Modelo mezclas.png", { exact: true }).count(), 0)
  await page.keyboard.press("Backspace")
  await page.getByRole("button", { name: "Modelo mezclas", exact: true }).waitFor()
  assert.equal(await page.getByRole("textbox", { name: "Buscar imágenes" }).inputValue(), "modelos")
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Teo existencia", exact: true }).waitFor()
  assert.equal(await page.getByRole("button", { name: "Modelo mezclas", exact: true }).count(), 0)
  assert.equal(await page.getByRole("textbox", { name: "Buscar imágenes" }).inputValue(), "")
  await page.keyboard.press("Backspace")
  await page.getByRole("button", { name: "Conceptos, 2 imágenes" }).waitFor()
  await page.keyboard.press("Backspace")
  await page.getByRole("dialog").waitFor({ state: "hidden" })
  assert.equal(await page.evaluate(() => window.recognitions.at(-1).aborted), true)
})

test("Backspace edita la búsqueda y los campos; atajos modificados no navegan ni escriben", async (t) => {
  const page = await setup(t)
  await openMatter(page)
  await createGroup(page, "Conceptos", [imageFile("Teorema.png")])
  await page.keyboard.type("teoremas")
  await page.getByRole("button", { name: "Teorema", exact: true }).waitFor()
  await page.keyboard.press("Backspace")
  assert.equal(await page.getByRole("textbox", { name: "Buscar imágenes" }).inputValue(), "teorema")
  await page.getByRole("button", { name: "Nuevo conjunto", exact: true }).click()
  const name = page.getByLabel("Nombre del conjunto", { exact: true })
  assert.equal(await name.inputValue(), "teorema")
  await name.fill("")
  await page.keyboard.press("Backspace")
  assert.equal(await page.getByRole("form", { name: "Crear conjunto" }).count(), 1)
  await page.keyboard.type("Nombre nuevo")
  assert.equal(await name.inputValue(), "Nombre nuevo")
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Teorema", exact: true }).waitFor()
  assert.equal(await page.getByRole("textbox", { name: "Buscar imágenes" }).inputValue(), "teorema")
  await page.keyboard.press("Escape")
  await page.getByRole("button", { name: "Conceptos, 1 imágenes" }).waitFor()
  await page.keyboard.press("Control+Backspace")
  await page.keyboard.press("Control+Escape")
  await page.keyboard.press("Control+k")
  assert.equal(await page.getByRole("dialog").count(), 1)
  assert.equal(await page.getByRole("textbox", { name: "Buscar imágenes" }).inputValue(), "")
  await page.getByRole("textbox", { name: "Buscar imágenes" }).fill("sin coincidencias")
  await page.getByText("Sin coincidencias", { exact: true }).waitFor()
  assert.equal(await page.getByRole("button", { name: "Nuevo conjunto", exact: true }).isDisabled(), true)
})

test("+ agrupa coincidencias sin duplicar los pares ni archivos y recupera los conteos tras recargar", async (t) => {
  const page = await setup(t)
  await openMatter(page)
  await createGroup(page, "Conceptos", [imageFile("Modelo lineal.png"), imageFile("Teo existencia.png"), imageFile("Modelo mezclas.png")])
  await createGroup(page, "Otros", [imageFile("Modelo circuitos.png")])
  const before = await manifest(page)
  const filesBefore = await page.evaluate(() => [...window.workspaceFiles.keys()].filter((path) => path.startsWith("subject-voice/images/")).sort())
  await page.keyboard.type("modelos")
  await page.getByRole("button", { name: "Modelo circuitos", exact: true }).waitFor()
  await page.getByRole("button", { name: "Nuevo conjunto", exact: true }).click()
  assert.equal(await page.getByLabel("Nombre del conjunto", { exact: true }).inputValue(), "modelos")
  await page.getByLabel("Nombre del conjunto", { exact: true }).fill("Modelos")
  await page.getByText("Amarillo", { exact: true }).click()
  await page.getByRole("button", { name: "Crear conjunto", exact: true }).click()
  await page.getByRole("button", { name: "Modelos, 3 imágenes" }).waitFor()
  await page.getByRole("button", { name: "Conceptos, 1 imágenes" }).waitFor()
  assert.equal(await page.getByRole("button", { name: "Otros, 0 imágenes" }).count(), 0)
  assert.equal(await page.getByRole("textbox", { name: "Buscar imágenes" }).inputValue(), "")
  const after = await manifest(page)
  assert.equal(after.version, 1)
  assert.equal(after.groups.some((group) => group.name === "Otros"), false)
  assert.equal(after.groups.find((group) => group.name === "Modelos").color, "#ffec99")
  assert.deepEqual(after.groups.flatMap((group) => group.images).sort((a, b) => a.id.localeCompare(b.id)), before.groups.flatMap((group) => group.images).sort((a, b) => a.id.localeCompare(b.id)))
  assert.deepEqual(await page.evaluate(() => [...window.workspaceFiles.keys()].filter((path) => path.startsWith("subject-voice/images/")).sort()), filesBefore)
  const small = await page.getByRole("button", { name: "Conceptos, 1 imágenes" }).boundingBox()
  const large = await page.getByRole("button", { name: "Modelos, 3 imágenes" }).boundingBox()
  assert.equal(large.width > small.width, true)
  await page.evaluate(() => document.fonts.ready)
  if (process.env.VOICE_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.VOICE_SCREENSHOT_DIR}/subject-voice-regroup-desktop.png` })
  await reloadHarness(page)
  await page.getByRole("button", { name: "Modelos, 3 imágenes" }).waitFor()
  await page.getByRole("button", { name: "Conceptos, 1 imágenes" }).waitFor()
})

test("fallo de agrupación conserva búsqueda, pares y conjunto hasta reintentar", async (t) => {
  const page = await setup(t)
  await openMatter(page)
  await createGroup(page, "Conceptos", [imageFile("Teo existencia.png"), imageFile("Teorema unicidad.png")])
  const before = await manifest(page)
  await page.keyboard.type("teoremas")
  await page.getByRole("button", { name: "Teo existencia", exact: true }).waitFor()
  await page.getByRole("button", { name: "Nuevo conjunto", exact: true }).click()
  await page.getByLabel("Nombre del conjunto", { exact: true }).fill("Teoremas")
  await page.evaluate(() => { window.failWritePath = "manifests/subject-voice/algebra/workspace.json" })
  await page.getByRole("button", { name: "Crear conjunto", exact: true }).click()
  await page.getByRole("button", { name: "Reintentar guardado" }).waitFor()
  assert.deepEqual(await manifest(page), before)
  assert.equal(await page.getByRole("form", { name: "Crear conjunto" }).count(), 1)
  await page.evaluate(() => { window.failWritePath = null })
  await page.getByRole("button", { name: "Reintentar guardado" }).click()
  await page.getByRole("button", { name: "Teoremas, 2 imágenes" }).waitFor()
  assert.equal((await manifest(page)).groups.length, 1)
})

test("móvil: campo sin borde y + permiten buscar y agrupar imágenes", async (t) => {
  const page = await setup(t, { viewport: { width: 390, height: 844 } })
  await openMatter(page)
  await createGroup(page, "Conceptos", [imageFile("Modelo lineal.png"), imageFile("Definición.png")])
  const search = page.getByRole("textbox", { name: "Buscar imágenes" })
  const emptyWidth = (await search.boundingBox()).width
  await search.fill("modelos")
  await page.getByRole("button", { name: "Modelo lineal", exact: true }).waitFor()
  assert.equal(await search.evaluate((element) => getComputedStyle(element).borderTopWidth), "0px")
  assert.ok((await search.boundingBox()).width > emptyWidth)
  const contentBounds = await page.locator('[data-voice-bubbles]').boundingBox()
  assert.equal(contentBounds.y,0)
  assert.equal(contentBounds.height,844)
  const background = await search.evaluate(element => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d')
    context.fillStyle = getComputedStyle(element.parentElement).backgroundColor
    context.fillRect(0,0,1,1)
    return [...context.getImageData(0,0,1,1).data]
  })
  assert.deepEqual(background.slice(0,3),[255,255,255])
  assert.ok(background[3] >= 240)
  assert.equal(await page.getByRole('button',{name:'Deshacer',exact:true}).count(),0)
  await page.evaluate(() => document.fonts.ready)
  if (process.env.VOICE_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.VOICE_SCREENSHOT_DIR}/subject-voice-search-mobile.png` })
  await page.getByRole("button", { name: "Nuevo conjunto", exact: true }).click()
  await page.getByRole("button", { name: "Crear conjunto", exact: true }).click()
  await page.getByRole("button", { name: "modelos, 1 imágenes" }).waitFor()
  await page.getByRole("button", { name: "Conceptos, 1 imágenes" }).waitFor()
})

test("+ sin búsqueda abre el selector y una escritura pendiente impide salir o volver", async (t) => {
  const page = await setup(t)
  await openMatter(page)
  const chooserEvent = page.waitForEvent("filechooser")
  await page.getByRole("button", { name: "Nuevo conjunto", exact: true }).focus()
  await page.keyboard.press("Space")
  const chooser = await chooserEvent
  await chooser.setFiles([imageFile("Modelo lineal.png")])
  await page.getByLabel("Nombre del conjunto", { exact: true }).fill("Conceptos")
  await page.evaluate(() => { window.holdWorkspaceWrites = true })
  await page.getByRole("button", { name: "Crear conjunto", exact: true }).click()
  await page.waitForFunction(() => window.writeStarted)
  await page.keyboard.press("Escape")
  await page.keyboard.press("Backspace")
  assert.equal(await page.getByRole("form", { name: "Crear conjunto" }).count(), 1)
  assert.equal(await page.getByRole("dialog").count(), 1)
  await page.evaluate(() => { window.holdWorkspaceWrites = false; window.releaseWorkspaceWrite() })
  await page.getByRole("button", { name: "Conceptos, 1 imágenes" }).waitFor()
})
