import assert from "node:assert/strict"
import test from "node:test"
import { scrollToFragmentRegion } from "../public/pdfjs/web/fragment-position.mjs"
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs"
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
const { PDFDocument, degrees } = require("../public/vendor/pdf-lib.min.js")

test("abre la página y convierte las coordenadas visibles del fragmento incluso con rotación", async () => {
  const source = await PDFDocument.create()
  for (const rotation of [0, 90, 180, 270]) source.addPage([600,800]).setRotation(degrees(rotation))
  const document = await getDocument({data:await source.save()}).promise
  try { for (let index = 0; index < 4; index++) {
    const viewport = (await document.getPage(index+1)).getViewport({scale:1})
    const calls: unknown[] = []
    const app = {
      pdfDocument: { numPages: 8, getPage: async (page: number) => {
        assert.equal(page, 5)
        return { getViewport: () => viewport }
      } },
      pdfViewer: { pagesPromise: Promise.resolve(), scrollPageIntoView: (options: unknown) => calls.push(options) },
    }
    assert.equal(await scrollToFragmentRegion(app, JSON.stringify({page:5,x1:0.2,y1:0.3,x2:0.8,y2:0.5})), true)
    const [x,y] = [[120,580],[165,160],[480,220],[435,640]][index]
    const actual = calls[0] as {pageNumber:number;destArray:unknown[]}
    assert.equal(actual.pageNumber, 5)
    assert.ok(Math.abs(Number(actual.destArray[2]) - x) < 0.001)
    assert.ok(Math.abs(Number(actual.destArray[3]) - y) < 0.001)
  } } finally { await document.destroy() }
})

test("coordenadas inválidas no cambian la posición del visor", async () => {
  const app = { pdfDocument:{numPages:8}, pdfViewer:{scrollPageIntoView:()=>assert.fail("No debe navegar")} }
  for (const region of ["invalid", "null", '{"page":9}', JSON.stringify({page:2,x1:0.8,y1:0.1,x2:0.2,y2:0.5})])
    assert.equal(await scrollToFragmentRegion(app, region), false)
})
