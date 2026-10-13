import assert from "node:assert/strict"
import test from "node:test"
import { build } from "esbuild"
import { chromium } from "@playwright/test"

test("long synthesis batches serialization and preserves typing, save, undo and structural IDs", async t => {
  const bundle = await build({ stdin: { contents: `
    import React, {useState} from 'react';
    import {createRoot} from 'react-dom/client';
    import {SimpleEditor} from './components/tiptap-templates/simple/simple-editor';
    const content={type:'doc',content:[{type:'heading',attrs:{level:1,synthesisId:'topic'},content:[{type:'text',text:'Tema'}]},
      ...Array.from({length:4000},(_,i)=>({type:'paragraph',content:[{type:'text',text:('Párrafo '+i+' explica el tema. ').repeat(12)}]}))]};
    window.changes=[];
    function App(){const [count,setCount]=useState(0);return React.createElement(SimpleEditor,{content,
      onChange:doc=>{window.changes.push(doc);setCount(c=>c+1)},
      onFlushReady:flush=>{window.flushEditor=flush}})}
    createRoot(document.querySelector('#root')).render(React.createElement(App));
  `, resolveDir: process.cwd(), loader: "tsx" }, bundle: true, write: false, platform: "browser", format: "iife",
    loader: { ".scss": "empty", ".css": "empty" }, define: { "process.env.NODE_ENV": '"production"' } })
  const browser = await chromium.launch({ headless: true })
  t.after(() => browser.close())
  const page = await browser.newPage()
  const errors = []
  page.on("pageerror", error => errors.push(error.message))
  await page.setContent('<!doctype html><div id="root"></div>')
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.waitForFunction(() => document.querySelector('.tiptap')?.editor && window.flushEditor)
  const result = await page.evaluate(async () => {
    const editor = document.querySelector('.tiptap').editor
    editor.commands.setTextSelection(2)
    editor.commands.insertContent('inicio')
    window.flushEditor()
    window.changes=[]
    let reads=0
    const original=editor.getJSON.bind(editor)
    editor.getJSON=()=>{reads++;return original()}
    const start=performance.now()
    for(let i=0;i<40;i++)editor.commands.insertContent('x')
    const typingMs=performance.now()-start
    const readsDuringTyping=reads
    await new Promise(resolve=>setTimeout(resolve,500))
    const readsAfterPause=reads
    const latest=window.changes.at(-1)
    editor.commands.insertContent('FINAL')
    window.flushEditor()
    const saved=window.changes.at(-1)
    editor.commands.undo()
    window.flushEditor()
    const undo=window.changes.at(-1)
    editor.commands.setTextSelection(2)
    editor.commands.splitBlock()
    window.flushEditor()
    const headings=window.changes.at(-1).content.filter(n=>n.type==='heading')
    return {typingMs,readsDuringTyping,readsAfterPause,latest,saved,undo,headings}
  })
  assert.equal(result.readsDuringTyping, 0)
  assert.equal(result.readsAfterPause, 1)
  assert.equal(result.latest.content.length, 4001)
  assert.ok(JSON.stringify(result.latest.content[0]).includes("x".repeat(40)))
  assert.ok(JSON.stringify(result.saved.content[0]).includes("FINAL"))
  assert.ok(!JSON.stringify(result.undo).includes("FINAL"))
  assert.equal(new Set(result.headings.map(node => node.attrs.synthesisId)).size, result.headings.length)
  assert.deepEqual(errors, [])
  console.log(`4000 párrafos: 40 inserciones en ${result.typingMs.toFixed(0)} ms; 0 serializaciones al teclear, 1 al pausar.`)
})
