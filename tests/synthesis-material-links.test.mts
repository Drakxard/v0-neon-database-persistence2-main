import assert from "node:assert/strict"
import test from "node:test"
import { createEmptySynthesisWorkspace, deriveSynthesisNodes, normalizeSynthesisWorkspace, repairSynthesisLayout, type SynthesisWorkspaceV2 } from "../lib/synthesis-workspace.ts"
import { hasSynthesisMaterialDevelopment, reconcileSynthesisMaterials, recordSynthesisRemovals, removeSynthesisMaterial, removeSynthesisNode, renameSynthesisMaterial } from "../lib/synthesis-material-links.ts"
import { readMaterialSynthesis, writeMaterialSynthesis } from "../lib/client/synthesis-materials.ts"
import { buildSynthesisLocalStorageKey } from "../lib/synthesis-context.ts"
import { SYNTHESIS_WORKSPACE_PENDING_KEY, SYNTHESIS_WORKSPACE_STORAGE_KEY } from "../lib/synthesis-workspace.ts"

const containers = [
  { id: 1, name: "Teoría", kind: "theory", orderIndex: 0 },
  { id: 2, name: "Práctica", kind: "practice", orderIndex: 1 },
  { id: 3, name: "Libro", kind: "custom", orderIndex: 2 },
]
const pdf = (id: number, container_id: number | null = 1, file_name = `Tema ${id}.pdf`) => ({ id, container_id, file_name, material_type: "theory", order_index: id })
const initial = () => reconcileSynthesisMaterials(createEmptySynthesisWorkspace(), containers, [pdf(1), pdf(2, 2)])
const names = (workspace: SynthesisWorkspaceV2) => deriveSynthesisNodes(workspace.document).map((node) => node.name)
const reload = (workspace: SynthesisWorkspaceV2) => normalizeSynthesisWorkspace(JSON.parse(JSON.stringify(workspace)))

test("convertir un H2 en H1 busca espacio libre sin mover los elementos de la pantalla principal", () => {
  const heading = (id: string, level: number) => ({ type: "heading", attrs: { synthesisId: id, level }, content: [{ type: "text", text: id }] })
  const workspace = normalizeSynthesisWorkspace({
    document: { type: "doc", content: [heading("padre", 1), heading("nuevo", 2), heading("existente", 1)] },
    layout: { padre: { x: .125, y: .28, scale: 1 }, nuevo: { x: .5, y: .28, scale: 1.3 }, existente: { x: .5, y: .28, scale: 1 } },
  })
  const document = structuredClone(workspace.document)
  document.content![1].attrs!.level = 1
  const edited = recordSynthesisRemovals(workspace, document)
  assert.deepEqual(edited.layout.existente, workspace.layout.existente)
  assert.deepEqual(edited.layout.padre, workspace.layout.padre)
  assert.notDeepEqual(edited.layout.nuevo, workspace.layout.nuevo)
  assert.equal(edited.layout.nuevo.scale, 1.3)
  assert.equal(deriveSynthesisNodes(edited.document).find((node) => node.id === "nuevo")?.parentId, null)
  assert.deepEqual(repairSynthesisLayout(reload(edited)), edited)
})

test("corrige elementos ya superpuestos al cargar y respeta posiciones libres en pantallas distintas", () => {
  const workspace = initial()
  const ids = Object.values(workspace.sources!.containers).map((link) => link.nodeId)
  for (const id of ids) workspace.layout[id] = { x: .5, y: .28, scale: 1 }
  const imageChildId = workspace.sources!.materials[1].nodeId
  workspace.layout[imageChildId] = { x: .5, y: .28, scale: 1 }
  const repaired = repairSynthesisLayout(workspace)
  assert.deepEqual(repaired.layout[ids[0]], workspace.layout[ids[0]])
  assert.deepEqual(repaired.layout[imageChildId], workspace.layout[imageChildId])
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = repaired.layout[ids[i]], b = repaired.layout[ids[j]]
    assert.ok(Math.abs(a.x - b.x) * 1366 >= 199 || Math.abs(a.y - b.y) * 768 >= 185)
  }
  assert.deepEqual(repaired.document, workspace.document)
})

test("tamaño general: documentos anteriores usan 16 px y la preferencia sobrevive a recarga y PDF nuevos", () => {
  assert.equal(normalizeSynthesisWorkspace(createEmptySynthesisWorkspace()).editorFontSize, 16)
  const workspace = initial()
  workspace.editorFontSize = 24
  const saved = reload(workspace)
  assert.equal(saved.editorFontSize, 24)
  assert.deepEqual(saved.document, workspace.document)
  const synced = reconcileSynthesisMaterials(saved, containers, [pdf(1), pdf(2, 2), pdf(3)])
  assert.equal(synced.editorFontSize, 24)
  assert.equal(removeSynthesisMaterial(synced, 1).editorFontSize, 24)
  assert.equal(normalizeSynthesisWorkspace({ ...workspace, editorFontSize: -1 }).editorFontSize, 16)
})

test("genera contenedores vacíos y PDF por ID, quitando solo la extensión final", () => {
  const workspace = reconcileSynthesisMaterials(createEmptySynthesisWorkspace(), containers, [pdf(1, null, "Tema.pdf.PDF"), pdf(2, 1, "Tema.pdf.PDF"), pdf(3, 3), pdf(4, 3, "audio.mp3")])
  const nodes = deriveSynthesisNodes(workspace.document)
  assert.deepEqual(nodes.filter((node) => node.parentId === null).map((node) => node.name), ["Teoría", "Práctica", "Libro"])
  assert.equal(nodes.filter((node) => node.name === "Tema.pdf").length, 2)
  assert.equal(nodes.find((node) => node.name === "Tema 3")?.parentId, workspace.sources!.containers[3].nodeId)
  assert.ok(!names(workspace).includes("audio.mp3"))
})

test("sincronización idempotente: conserva contenido, títulos manuales y posiciones; agrega PDF sin superponer", () => {
  const workspace = initial()
  const id = workspace.sources!.materials[1].nodeId
  const index = workspace.document.content!.findIndex((block) => block.attrs?.synthesisId === id)
  workspace.document.content![index].content = [{ type: "text", text: "Mi resumen" }]
  workspace.document.content!.splice(index + 1, 0, { type: "paragraph", content: [{ type: "text", text: "Desarrollo" }] })
  const saved = reload(workspace)
  const synced = reconcileSynthesisMaterials(saved, containers, [pdf(1), pdf(2, 2), pdf(3)])
  assert.equal(synced.sources!.materials[1].nodeId, id)
  assert.ok(names(synced).includes("Mi resumen"))
  assert.deepEqual(synced.layout[id], saved.layout[id])
  assert.notDeepEqual(synced.layout[id], synced.layout[synced.sources!.materials[3].nodeId])
  assert.equal(hasSynthesisMaterialDevelopment(synced, 1), true)
  assert.deepEqual(reconcileSynthesisMaterials(synced, containers, [pdf(1), pdf(2, 2), pdf(3)]), synced)
})

test("borrar un nodo no borra su fuente ni lo regenera tras recargar", () => {
  const workspace = initial()
  const deleted = removeSynthesisNode(workspace, workspace.sources!.materials[1].nodeId)
  const synced = reconcileSynthesisMaterials(reload(deleted), containers, [pdf(1), pdf(2, 2), pdf(3)])
  assert.ok(!names(synced).includes("Tema 1"))
  assert.ok(names(synced).includes("Tema 3"))
  assert.equal(synced.sources!.materials[1].dismissed, true)
})

test("borrar contenedor: sigue oculto hasta recibir un PDF nuevo y no recupera los viejos", () => {
  const workspace = initial()
  const deleted = removeSynthesisNode(workspace, workspace.sources!.containers[1].nodeId)
  assert.ok(!names(reconcileSynthesisMaterials(reload(deleted), containers, [pdf(1), pdf(2, 2)])).includes("Teoría"))
  const synced = reconcileSynthesisMaterials(reload(deleted), containers, [pdf(1), pdf(2, 2), pdf(3)])
  assert.ok(names(synced).includes("Teoría"))
  assert.ok(names(synced).includes("Tema 3"))
  assert.ok(!names(synced).includes("Tema 1"))
})

test("eliminar desde el editor se registra; deshacer restaura la asociación", () => {
  const workspace = initial()
  const id = workspace.sources!.materials[1].nodeId
  const document = structuredClone(workspace.document)
  document.content = document.content!.filter((block) => block.attrs?.synthesisId !== id)
  const removed = recordSynthesisRemovals(workspace, document)
  assert.equal(removed.sources!.materials[1].dismissed, true)
  const undone = recordSynthesisRemovals(removed, workspace.document)
  assert.equal(undone.sources!.materials[1].dismissed, false)
})

test("detecta desarrollo por título, imagen, texto o descendientes; ignora párrafos vacíos", () => {
  const workspace = initial()
  const id = workspace.sources!.materials[1].nodeId
  const index = workspace.document.content!.findIndex((block) => block.attrs?.synthesisId === id)
  workspace.document.content!.splice(index + 1, 0, { type: "paragraph" })
  assert.equal(hasSynthesisMaterialDevelopment(workspace, 1), false)
  for (const block of [
    { type: "paragraph", content: [{ type: "text", text: "Notas" }] },
    { type: "image", attrs: { src: "synthesis-local-image:one" } },
    { type: "heading", attrs: { level: 3, synthesisId: "child" }, content: [{ type: "text", text: "Subtema" }] },
  ]) {
    const edited = reload(workspace)
    edited.document.content!.splice(index + 1, 0, block)
    assert.equal(hasSynthesisMaterialDevelopment(edited, 1), true)
  }
  workspace.document.content![index].content = [{ type: "text", text: "Mi título" }]
  assert.equal(hasSynthesisMaterialDevelopment(workspace, 1), true)
})

test("reemplazar conserva nodo, imágenes y descendientes y actualiza solo títulos automáticos", () => {
  const workspace = initial()
  const id = workspace.sources!.materials[1].nodeId
  const index = workspace.document.content!.findIndex((block) => block.attrs?.synthesisId === id)
  workspace.document.content!.splice(index + 1, 0,
    { type: "image", attrs: { src: "synthesis-local-image:one" } },
    { type: "heading", attrs: { level: 3, synthesisId: "child" }, content: [{ type: "text", text: "Subtema" }] },
  )
  const replaced = renameSynthesisMaterial(workspace, 1, "Edición nueva.PDF")
  assert.equal(replaced.sources!.materials[1].nodeId, id)
  assert.ok(names(replaced).includes("Edición nueva"))
  assert.deepEqual(replaced.document.content!.slice(index + 1), workspace.document.content!.slice(index + 1))
  workspace.document.content![index].content = [{ type: "text", text: "Mi título" }]
  assert.ok(names(renameSynthesisMaterial(workspace, 1, "Edición nueva.pdf")).includes("Mi título"))
  const deleted = removeSynthesisMaterial(replaced, 1)
  assert.ok(!names(deleted).includes("Subtema"))
  assert.ok(names(deleted).includes("Tema 2"))
})

test("los nodos manuales no se vinculan por nombre y la organización editada se conserva", () => {
  const workspace = initial()
  const blocks = workspace.document.content!
  const id = workspace.sources!.materials[1].nodeId
  const index = blocks.findIndex((block) => block.attrs?.synthesisId === id)
  const [moved] = blocks.splice(index, 1)
  blocks.push(moved)
  blocks.unshift({ type: "heading", attrs: { synthesisId: "manual", level: 1 }, content: [{ type: "text", text: "Teoría" }] })
  const synced = reconcileSynthesisMaterials(workspace, containers, [pdf(1), pdf(2, 2)])
  assert.deepEqual(synced.document, workspace.document)
  assert.notEqual(synced.sources!.containers[1].nodeId, "manual")
})

test("almacenamiento aislado por materia y semana, compatible con pendientes y rechaza JSON corrupto", () => {
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) }
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage")
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window")
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage })
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() })
  try {
    const context = { subjectId: "algebra", weekNumber: 1 }
    writeMaterialSynthesis(context, initial())
    assert.ok(readMaterialSynthesis(context))
    assert.equal(readMaterialSynthesis({ ...context, weekNumber: 2 }), null)
    assert.equal(readMaterialSynthesis({ ...context, subjectId: "fisica" }), null)
    storage.setItem(buildSynthesisLocalStorageKey(SYNTHESIS_WORKSPACE_PENDING_KEY, context), JSON.stringify({ workspace: createEmptySynthesisWorkspace() }))
    assert.equal(names(readMaterialSynthesis(context)!).length, 0)
    writeMaterialSynthesis(context, initial())
    assert.equal(storage.getItem(buildSynthesisLocalStorageKey(SYNTHESIS_WORKSPACE_PENDING_KEY, context)), null)
    storage.setItem(buildSynthesisLocalStorageKey(SYNTHESIS_WORKSPACE_STORAGE_KEY, context), "{broken")
    assert.throws(() => readMaterialSynthesis(context))
  } finally {
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage)
    else Reflect.deleteProperty(globalThis, "localStorage")
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow)
    else Reflect.deleteProperty(globalThis, "window")
  }
})
