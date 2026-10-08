import assert from "node:assert/strict"
import test from "node:test"
import { Schema, Slice, Fragment } from "@tiptap/pm/model"
import { cleanSynthesisPaste } from "../lib/synthesis-paste.ts"

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    heading: { group: "block", content: "inline*", attrs: { level: { default: 1 }, synthesisId: { default: null }, synthesisParentId: { default: null } } },
    paragraph: { group: "block", content: "inline*" },
    codeBlock: { group: "block", content: "text*", code: true },
    text: { group: "inline" },
  },
  marks: { bold: {}, code: { code: true } },
})

test("el pegado elimina referencias entre marcas y conserva formato y texto original", () => {
  const paragraph = schema.node("paragraph", null, [
    schema.text("Texto ["),
    schema.text("1, 2", [schema.mark("bold")]),
    schema.text("] final", [schema.mark("bold")]),
  ])
  const original = new Slice(Fragment.from(paragraph), 1, 1)
  const cleaned = cleanSynthesisPaste(original)
  assert.equal(cleaned.content.firstChild!.textContent, "Texto  final")
  assert.equal(cleaned.content.firstChild!.lastChild!.marks[0].type.name, "bold")
  assert.equal(original.content.firstChild!.textContent, "Texto [1, 2] final")
  assert.equal(cleaned.openStart, 1)
  assert.equal(cleaned.openEnd, 1)
})

test("el pegado limpia tambien codigo y corchetes anidados, sin borrar corchetes incompletos", () => {
  const blocks = [
    schema.node("codeBlock", null, schema.text("a[1] [fuente [2]] b [incompleto")),
    schema.node("paragraph", null, schema.text("x[3]y", [schema.mark("code")])),
  ]
  const cleaned = cleanSynthesisPaste(new Slice(Fragment.fromArray(blocks), 0, 0))
  assert.equal(cleaned.content.child(0).textContent, "a  b [incompleto")
  assert.equal(cleaned.content.child(1).textContent, "xy")
})

test("el pegado convierte H1 en H3, conserva otros niveles y no modifica el original", () => {
  const blocks = [1, 2, 3].map((level) => schema.node("heading", { level, synthesisId: `h${level}` }, schema.text("Título [1]", [schema.mark("bold")])))
  const original = new Slice(Fragment.fromArray(blocks), 1, 1)
  const cleaned = cleanSynthesisPaste(original)
  assert.deepEqual([0, 1, 2].map((index) => cleaned.content.child(index).attrs.level), [3, 2, 3])
  assert.equal(cleaned.content.firstChild!.attrs.synthesisId, null)
  assert.equal(cleaned.content.firstChild!.textContent, "Título ")
  assert.equal(cleaned.content.firstChild!.firstChild!.marks[0].type.name, "bold")
  assert.equal(original.content.firstChild!.attrs.level, 1)
  assert.equal(original.content.firstChild!.textContent, "Título [1]")
  assert.equal(cleaned.openStart, 1)
  assert.equal(cleaned.openEnd, 1)
})
