import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import {
  addSynthesisNode,
  applyStructuredMarkdownTree,
  applyStructuredMarkdown,
  assertValidSynthesisTree,
  createEmptySynthesisTree,
  deleteSynthesisBranch,
  normalizeSynthesisTree,
  serializeSynthesisBranch,
  serializeSynthesisTree,
  synthesisChildren,
  synthesisPath,
  updateSynthesisNode,
} from "../lib/synthesis-tree.ts"
import {
  buildSynthesisLocalStorageKey,
  buildSynthesisTreeObjectKey,
  parseSynthesisContext,
} from "../lib/synthesis-context.ts"

function sampleTree() {
  let tree = createEmptySynthesisTree()
  tree = addSynthesisNode(tree, { id: "tema", parentId: null, name: "Tema", x: .2, y: .3 })
  tree = addSynthesisNode(tree, { id: "subtema", parentId: "tema", name: "Subtema", x: .4, y: .5 })
  tree = addSynthesisNode(tree, { id: "detalle", parentId: "subtema", name: "Detalle", x: .6, y: .7 })
  tree = updateSynthesisNode(tree, "tema", { content: "Introducción" })
  tree = updateSynthesisNode(tree, "subtema", { content: "Explicación" })
  return tree
}

test("normaliza estados heredados y evita ciclos", () => {
  const tree = normalizeSynthesisTree({ version: 2, defaultScale: 9, nodes: {
    a: { id: "a", parentId: "b", name: " A ", x: 8, y: -2 },
    b: { id: "b", parentId: "a", name: "B" },
    invalid: { id: "invalid", name: "" },
  } })
  assert.equal(tree.version, 1)
  assert.equal(tree.defaultScale, 2.4)
  assert.equal(tree.nodes.a.parentId, null)
  assert.equal(tree.nodes.invalid, undefined)
  assert.throws(() => assertValidSynthesisTree({ nodes: {
    a: { id: "a", parentId: "b", name: "A", x: 0, y: 0, scale: 1, content: "" },
    b: { id: "b", parentId: "a", name: "B", x: 0, y: 0, scale: 1, content: "" },
  } }), /ciclo/)
})

test("crea en coordenadas, conserva rutas y elimina ramas", () => {
  const tree = sampleTree()
  assert.deepEqual(synthesisPath(tree, "detalle"), ["Tema", "Subtema", "Detalle"])
  assert.deepEqual(synthesisChildren(tree, "tema").map(node => node.id), ["subtema"])
  assert.deepEqual(Object.keys(deleteSynthesisBranch(tree, "subtema")).sort(), ["defaultScale", "nodes", "revision", "updatedAt", "version"])
  assert.equal(deleteSynthesisBranch(tree, "subtema").nodes.tema.name, "Tema")
  assert.equal(deleteSynthesisBranch(tree, "subtema").nodes.detalle, undefined)
})

test("serializa y reaplica títulos, viñetas y sangría conservando ids", () => {
  const tree = sampleTree()
  const source = serializeSynthesisBranch(tree, "tema")
  assert.match(source, /^Introducción[\s\S]*# Subtema[\s\S]*- Detalle/)
  let sequence = 0
  const updated = applyStructuredMarkdown(tree, "tema", `${source}\nTexto detallado\n  - Nivel profundo`, () => `nuevo_${++sequence}`)
  assert.equal(updated.nodes.subtema.id, "subtema")
  assert.equal(updated.nodes.detalle.id, "detalle")
  assert.equal(updated.nodes.detalle.content, "Texto detallado")
  const deep = synthesisChildren(updated, "detalle")[0]
  assert.equal(deep.name, "Nivel profundo")
})

test("serializa y reaplica el árbol completo conservando identidad y posiciones", () => {
  let tree = sampleTree()
  tree = addSynthesisNode(tree, { id: "tema_b", parentId: null, name: "Tema B", x: .8, y: .3 })
  tree = updateSynthesisNode(tree, "detalle", { content: "Concepto interno" })
  const source = serializeSynthesisTree(tree)
  assert.match(source, /^# Tema[\s\S]*- Subtema[\s\S]*  - Detalle[\s\S]*# Tema B/)

  const updated = applyStructuredMarkdownTree(tree, source.replace("# Tema", "# Tema A renombrado") + "\n\n# Tema C", () => "tema_c")
  assert.equal(updated.nodes.tema.name, "Tema A renombrado")
  assert.equal(updated.nodes.tema.x, .2)
  assert.equal(updated.nodes.subtema.parentId, "tema")
  assert.equal(updated.nodes.detalle.content, "Concepto interno")
  assert.equal(updated.nodes.tema_c.name, "Tema C")

  const emptied = applyStructuredMarkdownTree(updated, "", () => "unused")
  assert.deepEqual(emptied.nodes, {})
  assert.throws(() => applyStructuredMarkdownTree(tree, "texto sin tema", () => "unused"), /comenzar con un título/)
})

test("aísla las claves de Síntesis por materia y semana", () => {
  const algebraWeek = parseSynthesisContext("algebra", "12")
  const physicsWeek = parseSynthesisContext("fisica", 12)
  const algebraNextWeek = parseSynthesisContext("algebra", 13)
  assert.notEqual(buildSynthesisTreeObjectKey(algebraWeek), buildSynthesisTreeObjectKey(physicsWeek))
  assert.notEqual(buildSynthesisTreeObjectKey(algebraWeek), buildSynthesisTreeObjectKey(algebraNextWeek))
  assert.notEqual(buildSynthesisLocalStorageKey("pending", algebraWeek), buildSynthesisLocalStorageKey("pending", physicsWeek))
  assert.match(buildSynthesisTreeObjectKey(algebraWeek), /by-subject\/algebra\/semana-12\/tree-v1\.json$/)
  assert.throws(() => parseSynthesisContext("../materia", 12), /materia/)
  assert.throws(() => parseSynthesisContext("algebra", -1), /semana/)
})

test("el contrato R2 usa clave estable, autenticación y ETag", () => {
  const storage = readFileSync(new URL("../lib/synthesis-tree-storage.ts", import.meta.url), "utf8")
  const route = readFileSync(new URL("../app/api/inscreen/synthesis-tree/route.ts", import.meta.url), "utf8")
  const client = readFileSync(new URL("../app/sintesis/synthesis-client.tsx", import.meta.url), "utf8")
  const home = readFileSync(new URL("../components/subject-wheel.tsx", import.meta.url), "utf8")
  assert.match(storage, /buildSynthesisTreeObjectKey/)
  assert.match(storage, /ifMatch|ifNoneMatch/)
  assert.match(storage, /SynthesisTreeConflictError/)
  assert.match(route, /requireAuthSession/)
  assert.match(route, /withInscreenUserConfig/)
  assert.match(client, /beforeunload/)
  assert.match(client, /SYNTHESIS_PENDING_KEY/)
  assert.match(route, /parseSynthesisContext/)
  assert.match(client, /buildSynthesisLocalStorageKey/)
  assert.match(client, /applyStructuredMarkdownTree/)
  assert.match(client, /NumpadAdd/)
  assert.match(home, /openCurrentSubjectSynthesis/)
  assert.match(home, /wood-plaque\.png/)
  assert.doesNotMatch(home, /href="\/sintesis"/)
})
