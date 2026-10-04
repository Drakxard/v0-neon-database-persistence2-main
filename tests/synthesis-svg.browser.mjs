import assert from "node:assert/strict"
import test from "node:test"
import { build } from "esbuild"
import { chromium } from "@playwright/test"
import { readFile } from "node:fs/promises"
import { buildRasterSvg } from "../public/pdfjs/web/raster-svg.mjs"

async function setup() {
  const bundle = await build({
    entryPoints: ["lib/client/synthesis-svg.ts"], bundle: true, write: false,
    platform: "browser", format: "iife", globalName: "synthesisSvg",
  })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  return { browser, page }
}

test("shared PDF.js serializer stacks and centers pages with the existing gap", () => {
  const svg = buildRasterSvg([{ width: 100, height: 200, image: "data:image/jpeg;base64,AA==" },
    { width: 80, height: 50, image: "data:image/jpeg;base64,AA==" }])
  assert.match(svg, /viewBox="0 0 100 266"/)
  assert.match(svg, /<image x="10" y="216" width="80" height="50"/)
})

test("exports complete editor appearance as standalone SVG using the PDF.js raster path", async () => {
  const { browser, page } = await setup()
  try {
    await page.setContent(`<style>
      *{box-sizing:border-box}body{margin:0}.tiptap{width:520px;padding:24px;font:18px/1.5 Arial;color:#34291f;background:#fffdf8}
      h2{font-size:26px}p{margin:12px 0}mark{background:#ffdd77}table{border-collapse:collapse;width:100%}
      td,th{border:1px solid #333;padding:8px}th{background:#ddd}.tableWrapper{overflow:auto}
      .synthesis-image-size-controls{position:absolute;background:#00ff00;width:80px;height:40px}img{display:block}ol{padding-left:30px}
      [data-type=taskList]{list-style:none;padding:0}[data-type=taskList] li{display:flex}
      [data-type=taskList] input{width:0;height:0;opacity:0;position:absolute}
      [data-type=taskList] label>span{display:block;position:relative;width:18px;height:18px;background:#222}
      [data-type=taskList] label>span::before{content:'';position:absolute;width:12px;height:12px;background:white}
    </style><div class="simple-editor-wrapper"><div class="tiptap" contenteditable="true">
      <h2>Título &amp; formato</h2><p>Texto <strong>negrita</strong> con <em>cursiva</em>, <mark>resaltado</mark>, H<sub>2</sub>O y x<sup>2</sup>.</p>
      <p>Primera línea<br/>Segunda línea<br/>Tercera línea con áéíóú ñ</p>
      <ol start="3"><li>Primero</li><li>Segundo</li></ol>
      <ul data-type="taskList"><li data-checked="true"><label><input type="checkbox" checked/><span></span></label><div>Tarea terminada</div></li></ul>
      <div class="tableWrapper"><table><tr><th>Columna A</th><th>Columna B</th></tr><tr><td>Celda 1</td><td>Celda 2</td></tr></table></div>
      <div class="synthesis-local-image" style="overflow:hidden"><img width="80" height="40"/><div class="synthesis-image-size-controls">CONTROL EXCLUIDO</div></div>
      <div style="height:2300px"></div><p>Última línea fuera de pantalla 😀 &lt;fin&gt;</p>
      <div style="overflow:clip"><img width="80" height="40"/></div>
    </div></div>`)
    const result = await page.evaluate(async () => {
      const canvas = document.createElement("canvas")
      canvas.width = 1600; canvas.height = 800
      const ctx = canvas.getContext("2d")
      ctx.fillStyle = "#ff0000"; ctx.fillRect(0, 0, canvas.width, canvas.height)
      const imageUrl = URL.createObjectURL(await new Promise((resolve) => canvas.toBlob(resolve)))
      await Promise.all(Array.from(document.querySelectorAll("img"), async (image) => {
        image.src = imageUrl; await image.decode()
      }))
      const source = document.querySelector(".tiptap")
      const before = source.outerHTML
      const selection = getSelection()
      const text = source.querySelector("strong").firstChild
      selection.setBaseAndExtent(text, 1, text, 4)
      window.scrollTo(0, 150)
      const svg = await synthesisSvg.buildSynthesisEditorSvg(source)
      const parsed = new DOMParser().parseFromString(svg, "image/svg+xml")
      const rendered = new Image()
      rendered.src = `data:image/svg+xml,${encodeURIComponent(svg)}`
      await rendered.decode()
      canvas.width = rendered.naturalWidth; canvas.height = rendered.naturalHeight
      ctx.drawImage(rendered, 0, 0)
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      let redPixels = 0, greenPixels = 0, darkPixels = 0
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] > 220 && pixels[i + 1] < 40 && pixels[i + 2] < 40) redPixels++
        if (pixels[i] < 40 && pixels[i + 1] > 220 && pixels[i + 2] < 40) greenPixels++
        if (pixels[i] < 150 && pixels[i + 1] < 150 && pixels[i + 2] < 150) darkPixels++
      }
      const sourceBounds = source.getBoundingClientRect()
      const regions = Array.from(source.querySelectorAll("h2,p,ol,table"), (element) => {
        const bounds = element.getBoundingClientRect()
        const data = ctx.getImageData(Math.round(bounds.x - sourceBounds.x), Math.round(bounds.y - sourceBounds.y), Math.round(bounds.width), Math.round(bounds.height)).data
        let dark = 0
        for (let i = 0; i < data.length; i += 4) if (data[i] < 150 && data[i + 1] < 150 && data[i + 2] < 150) dark++
        return dark
      })
      const tiles = await Promise.all(Array.from(parsed.querySelectorAll("image"), async (node) => {
        const image = new Image(); image.src = node.getAttribute("href"); await image.decode()
        return { y: Number(node.getAttribute("y")), width: Number(node.getAttribute("width")), height: Number(node.getAttribute("height")),
          pixelWidth: image.naturalWidth, pixelHeight: image.naturalHeight, jpeg: image.src.startsWith("data:image/jpeg") }
      }))
      // Exercise the same download function used by the toolbar.
      let download
      const originalClick = HTMLAnchorElement.prototype.click
      HTMLAnchorElement.prototype.click = function () { download = { name: this.download, href: this.href } }
      try { await synthesisSvg.exportSynthesisEditorSvg() } finally { HTMLAnchorElement.prototype.click = originalClick }
      const downloaded = await (await fetch(download.href)).text()
      return { error: parsed.querySelector("parsererror")?.textContent, foreignObject: svg.includes("foreignObject"),
        nativeText: parsed.querySelectorAll("text").length, originalUnchanged: before === source.outerHTML,
        selection: selection.toString(), scroll: window.scrollY, width: rendered.naturalWidth, height: rendered.naturalHeight,
        expectedHeight: source.scrollHeight, redPixels, greenPixels, darkPixels, regions, tiles,
        downloadedName: download.name, downloadMatches: downloaded === svg }
    })
    assert.equal(result.error, undefined)
    assert.equal(result.foreignObject, false)
    assert.equal(result.nativeText, 0, "same visual raster export as PDF.js")
    assert.equal(result.originalUnchanged, true)
    assert.equal(result.selection, "egr")
    assert.equal(result.scroll, 150)
    assert.equal(result.height, result.expectedHeight)
    assert.ok(result.redPixels >= 6000, "both images render, including the off-screen image")
    assert.equal(result.greenPixels, 0, "editor controls must not render")
    assert.ok(result.darkPixels > 1000)
    assert.ok(result.regions.every((dark) => dark > 20), "headings, formatted text, lists, tables and the last paragraph render")
    assert.equal(result.tiles.length, 2)
    assert.equal(result.tiles[1].y, result.tiles[0].height, "no gap or overlap between editor tiles")
    assert.ok(result.tiles.every((tile) => tile.jpeg && tile.pixelWidth === tile.width * 2 && tile.pixelHeight === tile.height * 2))
    assert.equal(result.downloadedName, "sintesis.svg")
    assert.equal(result.downloadMatches, true)

    const failure = await page.evaluate(async () => {
      const originalFetch = window.fetch
      window.fetch = async () => new Response("Unavailable", { status: 500 })
      try { await synthesisSvg.buildSynthesisEditorSvg(document.querySelector(".tiptap")); return "unexpected success" }
      catch (error) { return error.message }
      finally { window.fetch = originalFetch }
    })
    assert.match(failure, /No se pudo incrustar una imagen/, "do not download an incomplete SVG")
  } finally { await browser.close() }
})

test("web font appearance is baked into the SVG and renders offline", async () => {
  const { browser, page } = await setup()
  try {
    const font = await readFile("public/pdfjs/web/standard_fonts/LiberationSans-Regular.ttf")
    await page.route("https://svg-font.test/**", async (route) => {
      if (route.request().url().endsWith("font.ttf")) {
        await route.fulfill({ body: font, contentType: "font/ttf", headers: { "Access-Control-Allow-Origin": "*" } })
      } else {
        await route.fulfill({ body: '@font-face{font-family:"Export Test";src:url("./font.ttf")} @font-face{font-family:"Unused";src:url("./unused.ttf")}', contentType: "text/css", headers: { "Access-Control-Allow-Origin": "*" } })
      }
    })
    await page.setContent(`<style>@import url("https://svg-font.test/fonts.css");
      body{margin:0}.tiptap{width:520px;padding:24px;font:24px/1.5 "Export Test",monospace}
      </style><div class="tiptap"><p>Texto nítido con acentos: áéíóú ñ</p></div>`)
    const result = await page.evaluate(async () => {
      await document.fonts.load('24px "Export Test"')
      const source = document.querySelector(".tiptap")
      const withFont = await synthesisSvg.buildSynthesisEditorSvg(source)
      source.style.fontFamily = "monospace"
      const withoutFont = await synthesisSvg.buildSynthesisEditorSvg(source)
      return { withFont, withoutFont }
    })
    assert.doesNotMatch(result.withFont, /https:|foreignObject|@font-face/)
    const offline = await browser.newPage()
    await offline.route("**/*", (route) => route.abort())
    const differences = await offline.evaluate(async ({ withFont, withoutFont }) => {
      async function pixels(svg) {
        const image = new Image(); image.src = `data:image/svg+xml,${encodeURIComponent(svg)}`; await image.decode()
        const canvas = document.createElement("canvas"); canvas.width = 520; canvas.height = 200
        const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0)
        return ctx.getImageData(0, 0, 520, 200).data
      }
      const original = await pixels(withFont), fallback = await pixels(withoutFont)
      return original.reduce((count, value, i) => count + (Math.abs(value - fallback[i]) > 20 ? 1 : 0), 0)
    }, result)
    assert.ok(differences > 1000, "web font glyphs must survive export into a standalone offline image")
  } finally { await browser.close() }
})

test("documents taller than the canvas limit export every tile and final content", async () => {
  const { browser, page } = await setup()
  try {
    await page.setContent('<div class="tiptap" style="width:160px"><div style="height:34000px"></div><div style="height:30px;background:#0000ff"></div></div>')
    const result = await page.evaluate(async () => {
      const svg = await synthesisSvg.buildSynthesisEditorSvg(document.querySelector(".tiptap"))
      const parsed = new DOMParser().parseFromString(svg, "image/svg+xml")
      const tiles = Array.from(parsed.querySelectorAll("image"))
      const last = tiles.at(-1)
      const image = new Image(); image.src = last.getAttribute("href"); await image.decode()
      const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
      const ctx = canvas.getContext("2d"); ctx.drawImage(image, 0, 0)
      return { height: Number(parsed.documentElement.getAttribute("height")), count: tiles.length,
        bottom: Number(last.getAttribute("y")) + Number(last.getAttribute("height")),
        pixel: Array.from(ctx.getImageData(100, canvas.height - 20, 1, 1).data) }
    })
    assert.equal(result.height, 34030)
    assert.equal(result.count, 17)
    assert.equal(result.bottom, result.height)
    assert.ok(result.pixel[2] > 220 && result.pixel[0] < 40, "last content is rendered beyond 32767px")
  } finally { await browser.close() }
})
