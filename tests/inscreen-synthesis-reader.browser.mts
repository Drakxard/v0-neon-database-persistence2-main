import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import { build } from "esbuild"
import { chromium } from "@playwright/test"
import { createEmptySynthesisWorkspace } from "../lib/synthesis-workspace.ts"

test("provider → existing native text/image contract → offline-capable read-only reader", async t => {
  const formulas = [
    { latex: String.raw`\frac{1}{2}`, display: false },
    { latex: String.raw`\sqrt{x^2+1}`, display: true },
    { latex: String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`, display: true },
    { latex: "α + β", display: false },
    { latex: String.raw`\frac{1`, display: false },
    { latex: "</script><img src=x onerror=alert(1)>", display: false },
  ]
  const workspace = { ...createEmptySynthesisWorkspace(), document: { type: "doc", content: [
    { type: "heading", attrs: { level: 1, synthesisId: "db" }, content: [{ type: "text", text: "Tema" }] },
    { type: "paragraph", content: [{ type: "text", text: "Introducción propia del tema" }] },
    { type: "heading", attrs: { level: 1, synthesisId: "sub", synthesisParentId: "db" }, content: [{ type: "text", text: "Subtema" }] },
    { type: "paragraph", content: formulas.map(attrs => ({ type: "synthesisMath", attrs })) },
    { type: "heading", attrs: { level: 2, synthesisId: "subtitle" }, content: [{ type: "text", text: "Subtítulo interno" }] },
    { type: "image", attrs: { src: "synthesis-local-image:abc-123" } },
  ] } }
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="
  const bundle = await build({
    stdin: { contents: `export { GET as documentGET } from './app/api/inscreen/provider/synthesis/route'; export { GET as imageGET } from './app/api/inscreen/provider/synthesis-images/route';`, resolveDir: process.cwd() },
    bundle: true, write: false, platform: "node", format: "cjs",
    plugins: [{ name: "fixture-r2-and-provider", setup(builder) {
      const mocks: Record<string, string> = {
        "@/lib/inscreen-provider-pairing": `export class ProviderPairingError extends Error {} export function bearerToken(req){return req.headers.get('Authorization')==='Bearer test-token'?'test-token':null} export async function authorizeProviderToken(token,handler){return handler()}`,
        "@/lib/synthesis-tree-storage": `export async function readSynthesisWorkspace(){return {workspace:${JSON.stringify(workspace)},etag:'saved-revision'}}`,
        "@/lib/r2": `export async function listR2ObjectsByPrefix(){return []} export async function downloadR2Object(key){if(!key.endsWith('/abc-123'))throw new Error('missing'); return {buffer:Buffer.from('${png}','base64'),mimeType:'application/octet-stream'}}`,
      }
      builder.onResolve({ filter: /^@\/lib\// }, args => args.path in mocks ? { path: args.path, namespace: "fixture" } : undefined)
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ contents: mocks[args.path], loader: "js" }))
    } }],
  })
  const module = { exports: {} as { documentGET: (req: Request) => Promise<Response>; imageGET: (req: Request) => Promise<Response> } }
  new Function("module", "exports", bundle.outputFiles[0].text)(module, module.exports)
  const { documentGET, imageGET } = module.exports
  const request = (url: string) => new Request(url, { headers: { Authorization: "Bearer test-token" } })
  assert.equal((await documentGET(new Request("https://v0.test/api/inscreen/provider/synthesis?subjectId=db&weekNumber=1"))).status, 401)
  assert.equal((await imageGET(new Request("https://v0.test/api/inscreen/provider/synthesis-images?id=abc-123"))).status, 401)
  const response = await documentGET(request("https://v0.test/api/inscreen/provider/synthesis?subjectId=db&weekNumber=1"))
  assert.equal(response.status, 200)
  const projected = (await response.json()).workspace
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;")
  // The installed APK turns text into escaped HTML and image IDs into this URL.
  const mathBlock = projected.document.content.find((block: any) => block.content?.[0]?.text?.startsWith("[[INSCREEN-MATH-V1:"))
  const mathHtml = mathBlock.content.map((node: { text: string }) => `<strong>${escape(node.text)}</strong>`).join(" ")
  const code = mathBlock.content[0].text
  const metadata = projected.document.content.filter((block: any) => block.content?.[0]?.text === '\u2060')
    .map((block: any) => `<p><a href="${escape(block.content[0].marks[0].attrs.href)}">${block.content[0].text}</a></p>`)
  const body = metadata[1]+`<p>Texto ${mathHtml}</p><h2>Subtítulo interno</h2><pre><code>${escape(code)}</code></pre><img src="https://synthesis.local/images/abc-123" alt="Gráfico"><img src="https://synthesis.local/images/missing" alt="Ausente"><table><tr><td>Tabla</td></tr></table>`
  const nodes = [
    { index: 0, parent: null, name: "Tema", body: metadata[0]+"<p>Introducción propia del tema</p>", x: .5, y: .3, scale: 1 },
    { index: 1, parent: null, name: "Subtema", body, x: .5, y: .3, scale: 1 },
  ]
  const reader = readFileSync(path.resolve(process.cwd(), "../InScreen/modules/sintesis/reader.html"), "utf8")
    .replace("__INSCREEN_SYNTHESIS_FONT_SIZE__", "16")
    .replace("__INSCREEN_SYNTHESIS_NODES__", JSON.stringify(nodes).replaceAll("<", "\\u003c"))
  let servedReader=reader
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 400, height: 800 } })
  const errors: string[] = [], external: string[] = [], violations: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  await page.route("**/*", async route => {
    const url = new URL(route.request().url())
    if (url.hostname !== "synthesis.local") { external.push(url.href); return route.abort() }
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: servedReader })
    if (url.pathname.startsWith("/images/")) {
      const response = await imageGET(request("https://v0.test/api/inscreen/provider/synthesis-images?id=" + url.pathname.split("/").at(-1)))
      if (url.pathname.endsWith("abc-123")) assert.equal(response.headers.get("content-type"), "image/png")
      return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: Buffer.from(await response.arrayBuffer()) })
    }
    return route.fulfill({ status: 404, body: "" })
  })
  await page.exposeFunction("reportViolation", (uri: string) => violations.push(uri))
  await page.addInitScript(() => document.addEventListener("securitypolicyviolation", event => { (window as any).reportViolation(event.blockedURI) }))
  await page.goto("https://synthesis.local/")
  assert.equal(await page.getByRole("button", { name: "Abrir Subtema", exact: true }).count(), 0)
  await page.getByRole("button", { name: "Abrir Tema", exact: true }).click()
  await page.getByRole("button", { name: "Abrir Subtema", exact: true }).click()
  assert.equal(await page.locator(".synthesis-reader-math").count(), formulas.length)
  assert.equal(await page.locator(".katex").count(), 5)
  assert.equal(await page.locator(".katex-error").count(), 1)
  assert.equal(await page.locator(".synthesis-reader-math[data-display=true]").count(), 2)
  assert.equal(await page.locator("pre code").innerText(), code)
  assert.equal(await page.locator("#sheet h2").innerText(), "Subtítulo interno")
  assert.doesNotMatch(await page.locator("#sheet").innerText(), /INSCREEN-NODE-V1/)
  await page.waitForFunction(() => document.querySelector<HTMLImageElement>("#sheet img")?.naturalWidth === 1)
  await page.locator(".synthesis-image-error").waitFor()
  assert.match(await page.locator(".synthesis-image-error").innerText(), /Ausente/)
  assert.equal(await page.locator("[contenteditable=true],textarea,input,[role=toolbar]").count(), 0)
  await page.evaluate(async () => { await document.fonts.ready })
  assert.equal(await page.evaluate(() => document.fonts.check('16px KaTeX_Main')), true)
  assert.equal(await page.locator("#sheet img[src=x]").count(), 0)
  await page.evaluate(() => (window as any).readerBack())
  assert.equal(await page.getByRole("button", { name: "Abrir Subtema", exact: true }).count(), 1)
  await page.getByRole("button", { name: "Leer", exact: true }).click()
  assert.equal(await page.locator("#sheet section").count(), 2)
  assert.match(await page.locator("#sheet").innerText(), /Introducción propia del tema/)
  assert.equal(await page.locator("#sheet section h1").first().innerText(), "Tema")
  await page.evaluate(() => {
    const sheet=document.querySelector<HTMLElement>('#sheet')!,body=document.querySelector<HTMLElement>('#sheetBody')!;
    sheet.style.setProperty('--sheet-zoom','2');body.style.width='900px';sheet.scrollLeft=150;sheet.scrollTop=200;
    (window as any).readerBack();
  })
  await page.getByRole("button", { name: "Leer", exact: true }).click()
  assert.deepEqual(await page.evaluate(() => {
    const sheet=document.querySelector<HTMLElement>('#sheet')!,body=document.querySelector<HTMLElement>('#sheetBody')!;
    return {top:sheet.scrollTop,left:sheet.scrollLeft,zoom:sheet.style.getPropertyValue('--sheet-zoom'),width:body.style.width};
  }), {top:0,left:0,zoom:'1',width:''})
  await page.evaluate(() => (window as any).readerBack())
  await page.evaluate(() => (window as any).readerBack())
  await page.getByRole("button", { name: "Leer", exact: true }).click()
  assert.equal(await page.locator("#sheet section").count(), 2)
  assert.equal(await page.locator(".synthesis-reader-math").count(), formulas.length)
  const legacy = `[[INSCREEN-NODE-V1:${Buffer.from(JSON.stringify({id:'legacy',parentId:null})).toString('base64url')}]]`
  await page.evaluate(marker => {
    document.querySelector('#sheetBody')!.innerHTML='<p>Contenido conservado</p><p>'+marker+'</p><p>[[INSCREEN-NODE-V1:bm90LWpzb24]]</p><pre><code>'+marker+'</code></pre><p><code>'+marker+'</code></p>';
    (window as any).renderSheetContent();
  },legacy)
  assert.equal(await page.locator('#sheetBody > p').count(),2)
  assert.equal(await page.locator('#sheetBody > p').first().innerText(),'Contenido conservado')
  assert.equal(await page.locator('#sheetBody > pre code').innerText(),legacy)
  assert.equal(await page.locator('#sheetBody > p code').innerText(),legacy)
  assert.doesNotMatch(await page.locator('#sheetBody').innerText(),/bm90LWpzb24/)
  // A cached reader without hierarchy decoding must never print the new payload.
  servedReader=reader.replace('restoreHierarchy();render();','render();').replace('takeNodeMetadata(sheetBody);','')
  await page.reload()
  await page.getByRole('button',{name:'Abrir Tema',exact:true}).dispatchEvent('click')
  assert.match(await page.locator('#sheet').innerText(),/Introducción propia del tema/)
  assert.doesNotMatch(await page.locator('#sheet').innerText(),/INSCREEN-NODE-V1|eyJpZCI/)
  assert.deepEqual(errors, [])
  assert.deepEqual(external, [])
  assert.deepEqual(violations, [])
})
