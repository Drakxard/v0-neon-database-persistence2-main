import assert from "node:assert/strict"
import test from "node:test"
import { getSchema } from "@tiptap/core"
import StarterKit from "@tiptap/starter-kit"
import { TableKit, createTable } from "@tiptap/extension-table"
import { EditorState, TextSelection } from "@tiptap/pm/state"
import { addRowAfter, addColumnAfter } from "@tiptap/pm/tables"
import { createEmptySynthesisWorkspace, extractSynthesisBranchDocument, normalizeSynthesisWorkspace, replaceSynthesisBranch } from "../lib/synthesis-workspace.ts"
import { reconcileSynthesisMaterials, recordSynthesisRemovals } from "../lib/synthesis-material-links.ts"

const schema = getSchema([StarterKit, TableKit])

test("creates tables with the requested dimensions and supports inserting rows and columns", () => {
  const table = createTable(schema, 2, 3, true)
  assert.equal(table.childCount, 2)
  assert.equal(table.firstChild?.childCount, 3)
  assert.equal(table.firstChild?.firstChild?.type.name, "tableHeader")
  const doc = schema.nodes.doc.create(null, table)
  let state = EditorState.create({ doc, selection: TextSelection.create(doc, 4) })
  assert.equal(addRowAfter(state, (transaction) => { state = state.apply(transaction) }), true)
  assert.equal(addColumnAfter(state, (transaction) => { state = state.apply(transaction) }), true)
  assert.equal(state.doc.firstChild?.childCount, 3)
  assert.equal(state.doc.firstChild?.firstChild?.childCount, 4)
  state.doc.check()
})

test("a PDF branch retains table content, formatting and column widths after saving and reconciliation", () => {
  const containers = [{ id: 1, name: "Teoría", kind: "theory", orderIndex: 0 }]
  const materials = [{ id: 1, file_name: "Tema.pdf", container_id: 1, material_type: "theory", order_index: 0 }]
  const workspace = reconcileSynthesisMaterials(createEmptySynthesisWorkspace(), containers, materials)
  const id = workspace.sources!.materials[1].nodeId
  const branch = extractSynthesisBranchDocument(workspace.document, id)
  const table = JSON.parse(JSON.stringify(createTable(schema, 3, 2, true).toJSON()))
  table.content[1].content[0].attrs.colwidth = [180]
  table.content[1].content[0].content = [{ type: "paragraph", content: [{ type: "text", text: "Mi desarrollo", marks: [{ type: "bold" }] }] }]
  branch.content!.push(table)
  const edited = recordSynthesisRemovals(workspace, replaceSynthesisBranch(workspace.document, id, branch))
  const reloaded = reconcileSynthesisMaterials(normalizeSynthesisWorkspace(JSON.parse(JSON.stringify(edited))), containers, materials)
  const restored = extractSynthesisBranchDocument(reloaded.document, id).content!.find((node) => node.type === "table")
  assert.deepEqual(restored, table)
  schema.nodeFromJSON(restored).check()
})
