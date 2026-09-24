import assert from "node:assert/strict"
import test from "node:test"
import { build } from "esbuild"
import { chromium } from "@playwright/test"

test("exports native SVG with text, tables, list markers and original embedded images", async () => {
  const bundle = await build({
    entryPoints: ["lib/client/synthesis-svg.ts"], bundle: true, write: false,
    platform: "browser", format: "iife", globalName: "synthesisSvg",
  })
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
    await page.setContent(`<style>
      *{box-sizing:border-box} body{margin:0} .tiptap{width:520px;padding:24px;font:18px/1.5 Arial;color:#34291f;background:#fffdf8}
      h2{font-size:26px} p{margin:12px 0} mark{background:#ffdd77} table{border-collapse:collapse;width:100%}
      td,th{border:1px solid #333;padding:8px} th{background:#ddd} .tableWrapper{overflow:auto}
      .synthesis-image-size-controls{position:absolute} img{display:block} ol{padding-left:30px}
      [data-type=taskList]{list-style:none;padding:0} [data-type=taskList] li{display:flex}
      [data-type=taskList] input{width:0;height:0;opacity:0;position:absolute}
      [data-type=taskList] label>span{display:block;position:relative;width:18px;height:18px;background:#222}
      [data-type=taskList] label>span::before{content:'';position:absolute;width:12px;height:12px;background:white}
    </style><div class="simple-editor-wrapper"><div class="tiptap" contenteditable="true">
      <h2>Título &amp; formato</h2><p>Texto <strong>negrita</strong> con <em>cursiva</em>, <mark>resaltado</mark>, H<sub>2</sub>O y x<sup>2</sup>.
      Una línea suficientemente larga para comprobar que mantiene los saltos del navegador.</p>
      <ol start="3"><li>Primero</li><li>Segundo</li></ol>
      <ul data-type="taskList"><li data-checked="true"><label><input type="checkbox" checked/><span></span></label><div>Tarea terminada</div></li></ul>
      <div class="tableWrapper"><table><tr><th>Columna A</th><th>Columna B</th></tr><tr><td>Celda 1</td><td>Celda 2</td></tr></table></div>
      <div class="synthesis-local-image" style="overflow:hidden"><img width="80" height="40"/><div class="synthesis-image-size-controls"><button>CONTROL EXCLUIDO</button></div></div>
      <div style="height:900px"></div><p>Última línea fuera de pantalla 😀 &lt;fin&gt;</p>
      <div style="overflow:clip"><img width="80" height="40"/></div>
    </div></div>`)
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    const result = await page.evaluate(async () => {
      const canvas = document.createElement("canvas")
      canvas.width = 1600; canvas.height = 800
      const context = canvas.getContext("2d")
      context.fillStyle = "#ff0000"; context.fillRect(0, 0, canvas.width, canvas.height)
      const expectedImage = canvas.toDataURL()
      const imageUrl = URL.createObjectURL(await new Promise((resolve) => canvas.toBlob(resolve)))
      await Promise.all(Array.from(document.querySelectorAll("img"), async (image) => {
        image.src = imageUrl
        await image.decode()
      }))
      const source = document.querySelector(".tiptap")
      const before = source.outerHTML
      const selection = getSelection()
      const text = source.querySelector("strong").firstChild
      selection.setBaseAndExtent(text, 1, text, 4)
      window.scrollTo(0, 150)
      const svg = await synthesisSvg.buildSynthesisEditorSvg(source)
      const parsed = new DOMParser().parseFromString(svg, "image/svg+xml")
      const svgImage = parsed.querySelector("image")
      const embedded = svgImage.getAttribute("href")
      const sourceRect = source.getBoundingClientRect()
      const expectedPositions = Array.from(source.querySelectorAll("img"), (image) => {
        const rect = image.getBoundingClientRect()
        return [rect.x - sourceRect.x, rect.y - sourceRect.y, rect.width, rect.height].map((n) => Math.round(n * 100) / 100)
      })
      const textContent = Array.from(parsed.querySelectorAll("text"), (node) => node.textContent).join(" ")
      // Disable all CSS in the exported document: content must remain native
      // SVG, without an HTML renderer or page stylesheets to make it visible.
      parsed.querySelectorAll("style, foreignObject").forEach((node) => node.remove())
      const rendered = new Image()
      rendered.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(parsed))}`
      await rendered.decode()
      canvas.width = rendered.naturalWidth; canvas.height = rendered.naturalHeight
      context.drawImage(rendered, 0, 0)
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
      let redPixels = 0, darkPixels = 0
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] > 245 && pixels[i + 1] < 10 && pixels[i + 2] < 10) redPixels++
        if (pixels[i] < 150 && pixels[i + 1] < 150 && pixels[i + 2] < 150 && pixels[i + 3] > 200) darkPixels++
      }
      return {
        error: parsed.querySelector("parsererror")?.textContent,
        foreignObject: svg.includes("foreignObject"), textContent, embedded, expectedImage,
        originalUnchanged: before === source.outerHTML,
        selection: selection.toString(), scroll: window.scrollY,
        imageCount: parsed.querySelectorAll("image").length,
        flatImages: Array.from(parsed.querySelectorAll("image"), (image) => image.parentElement === parsed.documentElement && !image.hasAttribute("xlink:href") && image.getAttribute("preserveAspectRatio") === "none"),
        imagePositions: Array.from(parsed.querySelectorAll("image"), (image) => ["x", "y", "width", "height"].map((name) => Number(image.getAttribute(name)))),
        expectedPositions,
        height: rendered.naturalHeight, redPixels, darkPixels,
        shapes: parsed.querySelectorAll("rect,path,line").length,
        baselineCss: parsed.querySelectorAll("[dominant-baseline]").length,
        checkmark: !!parsed.querySelector('path[d="M3 12L9 18L21 6"]'),
      }
    })
    assert.equal(result.error, undefined)
    assert.equal(result.foreignObject, false)
    assert.match(result.textContent, /negrita/)
    assert.match(result.textContent, /3\./)
    assert.match(result.textContent, /4\./)
    assert.match(result.textContent, /Columna A/)
    assert.match(result.textContent, /Última línea fuera de pantalla/)
    assert.doesNotMatch(result.textContent, /CONTROL EXCLUIDO/)
    assert.equal(result.embedded, result.expectedImage, "image bytes are preserved, without resizing or recompression")
    assert.equal(result.imageCount, 2)
    assert.deepEqual(result.flatImages, [true, true], "Secuencial images use direct href, without converter groups or masks")
    assert.deepEqual(result.imagePositions, result.expectedPositions)
    assert.equal(result.originalUnchanged, true)
    assert.equal(result.selection, "egr")
    assert.equal(result.scroll, 150)
    assert.ok(result.height > 900)
    assert.ok(result.redPixels >= 6000, "both images render, including the off-screen image inside an overflow container")
    assert.ok(result.darkPixels > 1000, "native text and table borders must actually render")
    assert.ok(result.shapes > 5)
    assert.equal(result.baselineCss, 0)
    assert.equal(result.checkmark, true)

    const failure = await page.evaluate(async () => {
      const originalFetch = window.fetch
      window.fetch = async () => new Response("Unavailable", { status: 500 })
      try {
        await synthesisSvg.buildSynthesisEditorSvg(document.querySelector(".tiptap"))
        return "unexpected success"
      } catch (error) {
        return error.message
      } finally {
        window.fetch = originalFetch
      }
    })
    assert.match(failure, /No se pudo incrustar una imagen/, "do not silently download an incomplete SVG")
  } finally {
    await browser.close()
  }
})
