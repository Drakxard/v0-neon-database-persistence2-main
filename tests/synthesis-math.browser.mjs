import assert from "node:assert/strict"
import test from "node:test"
import { build } from "esbuild"
import { chromium } from "@playwright/test"

test("pega NotebookLM con listas, marcas y fórmulas; guarda, reabre y deshace", async t => {
  const bundle = await build({stdin:{contents:`
    import { Editor } from '@tiptap/core';
    import StarterKit from '@tiptap/starter-kit';
    import { SynthesisMath } from './components/synthesis/math-extension';
    import { CleanReferencePaste } from './components/synthesis/clean-reference-paste';
    import { normalizeSynthesisMath } from './lib/synthesis-math';
    import { deriveSynthesisNodes, normalizeSynthesisWorkspace } from './lib/synthesis-workspace';
    window.synthesisNodes = document => deriveSynthesisNodes(normalizeSynthesisWorkspace({document}).document);
    window.openEditor = content => {
      window.mathEditor?.destroy();
      window.mathEditor = new Editor({element:document.querySelector('#editor'),extensions:[StarterKit,SynthesisMath,CleanReferencePaste],content:normalizeSynthesisMath(content)});
    };
    window.openEditor({type:'doc',content:[{type:'paragraph'}]});
  `,resolveDir:process.cwd(),loader:"ts"},bundle:true,write:false,platform:"browser",format:"iife"})
  const browser = await chromium.launch({headless:true})
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.setContent('<!doctype html><html><body><div id="editor"></div></body></html>')
  await page.addScriptTag({content:bundle.outputFiles[0].text})
  await page.evaluate(() => {
    const clipboard = new DataTransfer()
    clipboard.setData('text/html', String.raw`<h2>Resolución de un PVI</h2><ol><li><p><strong>Solución completa:</strong> \(y(x)=y_c(x)+y_p(x)\) [2]</p></li><li><p><em>Condiciones iniciales</em> \(y^{(n-1)}(x_0)=y_{n-1}\)</p></li></ol><p>\[f(x)=[a,b]\]</p><p><span class="katex"><span class="katex-mathml"><math><semantics><annotation encoding="application/x-tex">c_1, c_2, \dots, c_n</annotation></semantics></math></span><span class="katex-html">duplicado visual</span></span></p>`)
    window.mathEditor.commands.focus()
    window.mathEditor.view.dom.dispatchEvent(new ClipboardEvent('paste',{clipboardData:clipboard,bubbles:true,cancelable:true}))
  })
  assert.equal(await page.locator('[data-synthesis-math] .katex').count(),4, JSON.stringify(await page.evaluate(() => ({doc:window.mathEditor.getJSON(),html:document.querySelector("#editor").innerHTML}))))
  assert.equal(await page.locator('ol li').count(),2)
  assert.equal(await page.locator('strong').innerText(),'Solución completa:')
  assert.equal(await page.locator('em').innerText(),'Condiciones iniciales')
  assert.doesNotMatch(await page.locator('#editor').innerText(),/duplicado visual|\[2\]/)
  const saved = await page.evaluate(() => window.mathEditor.getJSON())
  await page.evaluate(() => window.mathEditor.commands.undo())
  assert.equal(await page.locator('[data-synthesis-math]').count(),0)
  await page.evaluate(content => window.openEditor(content),saved)
  assert.equal(await page.locator('[data-synthesis-math] .katex').count(),4)
  assert.deepEqual(await page.evaluate(() => window.mathEditor.getJSON()),saved)
  await page.evaluate(() => {
    window.openEditor({type:'doc',content:[{type:'paragraph'}]})
    const clipboard = new DataTransfer()
    clipboard.setData('text/html', '<h1>Delimitador pegado</h1><p>Contenido</p><h3>Subtítulo</h3>')
    window.mathEditor.commands.focus()
    window.mathEditor.view.dom.dispatchEvent(new ClipboardEvent('paste',{clipboardData:clipboard,bubbles:true,cancelable:true}))
  })
  assert.equal(await page.locator('#editor h1').count(), 0)
  assert.equal(await page.locator('#editor h3').count(), 2)
  const pasted = await page.evaluate(() => window.mathEditor.getJSON())
  assert.deepEqual(await page.evaluate(document => window.synthesisNodes(document), pasted), [])
  await page.evaluate(() => window.mathEditor.commands.setTextSelection(1) && window.mathEditor.commands.setHeading({level:1}))
  assert.equal(await page.evaluate(() => window.synthesisNodes(window.mathEditor.getJSON()).length), 1)
})
