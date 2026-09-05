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
  buildSynthesisReturnTokenStorageKey,
  buildSynthesisTreeObjectKey,
  buildSynthesisWorkspaceObjectKey,
  parseSynthesisContext,
} from "../lib/synthesis-context.ts"
import {
  SYNTHESIS_LOCAL_IMAGE_PREFIX,
  createEmptySynthesisWorkspace,
  deriveSynthesisNodes,
  ensureSynthesisDocument,
  extractSynthesisBranchDocument,
  normalizeSynthesisWorkspace,
  referencedLocalImageIds,
  replaceSynthesisBranch,
} from "../lib/synthesis-workspace.ts"

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
  assert.notEqual(buildSynthesisReturnTokenStorageKey(algebraWeek), buildSynthesisReturnTokenStorageKey(physicsWeek))
  assert.notEqual(buildSynthesisReturnTokenStorageKey(algebraWeek), buildSynthesisReturnTokenStorageKey(algebraNextWeek))
  assert.match(buildSynthesisTreeObjectKey(algebraWeek), /by-subject\/algebra\/semana-12\/tree-v1\.json$/)
  assert.throws(() => parseSynthesisContext("../materia", 12), /materia/)
  assert.throws(() => parseSynthesisContext("algebra", -1), /semana/)
})

test("Síntesis queda solo local y su endpoint R2 está desactivado", () => {
  const route = readFileSync(new URL("../app/api/inscreen/synthesis-tree/route.ts", import.meta.url), "utf8")
  const client = readFileSync(new URL("../app/sintesis/synthesis-client.tsx", import.meta.url), "utf8")
  const page = readFileSync(new URL("../app/sintesis/page.tsx", import.meta.url), "utf8")
  const styles = readFileSync(new URL("../app/sintesis/sintesis.module.css", import.meta.url), "utf8")
  const editor = readFileSync(new URL("../components/tiptap-templates/simple/simple-editor.tsx", import.meta.url), "utf8")
  const dropdownStyles = readFileSync(new URL("../components/tiptap-ui-primitive/dropdown-menu/dropdown-menu.scss", import.meta.url), "utf8")
  const popoverStyles = readFileSync(new URL("../components/tiptap-ui-primitive/popover/popover.scss", import.meta.url), "utf8")
  const home = readFileSync(new URL("../components/subject-wheel.tsx", import.meta.url), "utf8")
  const openSynthesis = home.match(/const openCurrentSubjectSynthesis = useCallback\(async \(\) => \{[\s\S]*?\n  \}, \[/)?.[0] ?? ""
  assert.match(client, /beforeunload/)
  assert.match(client, /buildSynthesisLocalStorageKey/)
  assert.match(client, /replaceSynthesisBranch/)
  assert.match(client, /NumpadAdd/)
  assert.doesNotMatch(client, /fetch\("\/api\/inscreen\/synthesis-tree/)
  assert.doesNotMatch(client, /etagRef|syncNowRef|Guardado en R2/)
  assert.doesNotMatch(client, /sheetNodeId|editable=\{false\}/)
  assert.match(client, /setCurrentParentId\(node\.id\)/)
  assert.match(client, /openEditor\(currentParentId\)/)
  assert.match(styles, /\.backPlaque[^}]*wood-plaque\.png/)
  const editorLayer = Number(styles.match(/\.editorOnly\s*\{[^}]*z-index:\s*(\d+)/)?.[1])
  const dropdownLayer = Number(dropdownStyles.match(/\.tiptap-dropdown-menu-content\s*\{[^}]*z-index:\s*(\d+)/s)?.[1])
  const popoverLayer = Number(popoverStyles.match(/\.tiptap-popover\s*\{[^}]*z-index:\s*(\d+)/s)?.[1])
  assert.ok(dropdownLayer > editorLayer, "los menús H y lista deben quedar sobre la hoja del editor")
  assert.ok(popoverLayer > editorLayer, "la paleta de remarcar debe quedar sobre la hoja del editor")
  assert.match(editor, /mobileView !== "main"[^}]*toolbarRef\.current\?\.scrollTo/)
  assert.doesNotMatch(page, /subjectName/)
  assert.match(route, /status: 503/)
  assert.doesNotMatch(route, /readSynthesisWorkspace|writeSynthesisWorkspace|uploadR2Object/)
  assert.match(home, /openCurrentSubjectSynthesis/)
  assert.match(openSynthesis, /sessionStorage\.setItem\(buildSynthesisReturnTokenStorageKey/)
  assert.doesNotMatch(openSynthesis, /subjectName:|params\.set\("returnToken"/)
  assert.match(home, /wood-plaque\.png/)
  assert.doesNotMatch(home, /href="\/sintesis"/)
})

test("v2 representa una Síntesis vacía con un párrafo editable sin crear nodos", () => {
  const emptyDocument = { type: "doc", content: [{ type: "paragraph" }] }
  const workspace = createEmptySynthesisWorkspace()
  assert.deepEqual(workspace.document, emptyDocument)
  assert.deepEqual(deriveSynthesisNodes(workspace.document), [])

  let generatedIds = 0
  const migratedDocument = ensureSynthesisDocument(
    { type: "doc", content: [] },
    () => `unexpected-${++generatedIds}`
  )
  assert.deepEqual(migratedDocument, emptyDocument)
  assert.equal(generatedIds, 0)
  assert.deepEqual(deriveSynthesisNodes(migratedDocument), [])

  const normalizedWorkspace = normalizeSynthesisWorkspace({
    version: 2,
    document: { type: "doc", content: [] },
    layout: {},
  })
  assert.deepEqual(normalizedWorkspace.document, emptyDocument)
})

test("v2 deriva nodos por encabezados y conserva las listas como contenido", () => {
  const document = ensureSynthesisDocument({ type: "doc", content: [
    { type: "heading", attrs: { level: 1, synthesisId: "h1" }, content: [{ type: "text", text: "Tema" }] },
    { type: "paragraph", content: [{ type: "text", marks: [{ type: "bold" }], text: "Introducción" }] },
    { type: "heading", attrs: { level: 2, synthesisId: "h2" }, content: [{ type: "text", text: "Subtema" }] },
    { type: "heading", attrs: { level: 3, synthesisId: "h3" }, content: [{ type: "text", text: "Concepto" }] },
    { type: "bulletList", content: [{ type: "listItem", attrs: { synthesisId: "bullet" }, content: [
      { type: "paragraph", content: [{ type: "text", text: "Viñeta" }] },
      { type: "orderedList", content: [{ type: "listItem", attrs: { synthesisId: "ordered" }, content: [{ type: "paragraph", content: [{ type: "text", text: "Numerada" }] }] }] },
      { type: "taskList", content: [{ type: "taskItem", attrs: { synthesisId: "task", checked: true }, content: [{ type: "paragraph", content: [{ type: "text", text: "Tarea" }] }] }] },
    ] }] },
  ] }, () => "unused")
  const nodes = deriveSynthesisNodes(document)
  assert.deepEqual(nodes.map(({ id, parentId }) => [id, parentId]), [
    ["h1", null], ["h2", "h1"], ["h3", "h2"],
  ])
  assert.equal(nodes[0].body[0].content?.[0].marks?.[0].type, "bold")
  assert.deepEqual(nodes[2].body, [document.content![4]])
})

test("v2 normaliza contenido huérfano y conserva IDs, posiciones y formato", () => {
  let sequence = 0
  const document = ensureSynthesisDocument({ type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", marks: [{ type: "italic" }], text: "Antes del título" }] },
    { type: "heading", attrs: { level: 1, synthesisId: "tema" }, content: [{ type: "text", text: "Tema" }] },
  ] }, () => `auto-${++sequence}`)
  assert.equal(document.content?.[0].type, "heading")
  assert.equal(document.content?.[0].content?.[0].text, "Sin título")
  assert.equal(document.content?.[0].attrs?.synthesisId, "auto-1")
  const workspace = normalizeSynthesisWorkspace({ version: 2, document, layout: { tema: { x: .8, y: .7, scale: 1.2 } } })
  assert.deepEqual(workspace.layout.tema, { x: .8, y: .7, scale: 1.2 })
  assert.equal(JSON.stringify(workspace.document).includes("italic"), true)
})

test("v2 extrae y reintegra una rama sin inferir identidad por texto", () => {
  const document = ensureSynthesisDocument({ type: "doc", content: [
    { type: "heading", attrs: { level: 1, synthesisId: "a" }, content: [{ type: "text", text: "A" }] },
    { type: "paragraph", content: [{ type: "text", text: "cuerpo" }] },
    { type: "heading", attrs: { level: 1, synthesisId: "b" }, content: [{ type: "text", text: "B" }] },
  ] }, () => "unused")
  const branch = extractSynthesisBranchDocument(document, "a")
  branch.content![0].content![0].text = "Renombrado"
  const replaced = replaceSynthesisBranch(document, "a", branch)
  const derived = deriveSynthesisNodes(replaced)
  assert.equal(derived[0].id, "a")
  assert.equal(derived[0].name, "Renombrado")
  assert.equal(derived[1].id, "b")
})

test("v2 guarda imágenes como IDs locales y usa una clave R2 nueva y aislada", () => {
  const document = { type: "doc", content: [{ type: "image", attrs: { src: `${SYNTHESIS_LOCAL_IMAGE_PREFIX}asset-1` } }] }
  assert.deepEqual(referencedLocalImageIds(document), ["asset-1"])
  const first = parseSynthesisContext("materia-custom", 23)
  const second = parseSynthesisContext("materia-custom", 24)
  assert.match(buildSynthesisWorkspaceObjectKey(first), /semana-23\/synthesis-v2\.json$/)
  assert.notEqual(buildSynthesisWorkspaceObjectKey(first), buildSynthesisWorkspaceObjectKey(second))
})
