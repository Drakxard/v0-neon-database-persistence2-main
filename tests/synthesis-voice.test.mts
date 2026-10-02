import assert from "node:assert/strict"
import test from "node:test"
import {
  classifySynthesisVoiceCommand,
  decideSynthesisVoiceDestination,
  validateVoiceTree,
  voiceNodePath,
} from "../lib/synthesis-voice-navigation.ts"
import { findEditedSynthesisNode, normalizeSynthesisWorkspace } from "../lib/synthesis-workspace.ts"
import { removeSynthesisNode } from "../lib/synthesis-material-links.ts"
import { readFileSync } from "node:fs"

const nodes = validateVoiceTree([
  { id: "calculo", parentId: null, name: "Cálculo" },
  { id: "integrales", parentId: "calculo", name: "Integrales" },
  { id: "definidas", parentId: "integrales", name: "Integrales definidas" },
  { id: "derivadas", parentId: "calculo", name: "Derivadas" },
])

test("reconoce comandos explícitos sin mostrar ni almacenar la transcripción", () => {
  assert.equal(classifySynthesisVoiceCommand("Temas"), "topics")
  assert.equal(classifySynthesisVoiceCommand("mostrame los temas"), "topics")
  assert.equal(classifySynthesisVoiceCommand("ir a la última edición"), "latest_edit")
  assert.equal(classifySynthesisVoiceCommand("Abre"), "edit")
  assert.equal(classifySynthesisVoiceCommand("integrales definidas"), "search")
  assert.equal(voiceNodePath(nodes, "definidas"), "Cálculo > Integrales > Integrales definidas")
})

test("Jev elige un nodo profundo y una elección incierta ofrece alternativas", async () => {
  const chosen = await decideSynthesisVoiceDestination("integrales definidas", nodes, null, async (_state, criteria) => {
    assert.match(criteria.n2, /Integrales definidas/)
    return { choice: "n2", probabilities: { n2: 0.9, n1: 0.06, none: 0.04 } }
  })
  assert.deepEqual(chosen, { action: "navigate", nodeId: "definidas" })

  const uncertain = await decideSynthesisVoiceDestination("integral", nodes, null, async () => ({
    choice: "n1", probabilities: { n1: 0.49, n2: 0.45, none: 0.06 },
  }))
  assert.deepEqual(uncertain, { action: "suggest", nodeIds: ["integrales", "definidas"] })

  const invalid = await decideSynthesisVoiceDestination("derivadas", nodes, null, async () => ({
    choice: "n999", probabilities: { n3: 0.98 },
  }))
  assert.deepEqual(invalid, { action: "suggest", nodeIds: ["derivadas"] })
})

test("árboles grandes conservan el acceso a nodos fuera del primer grupo", async () => {
  const large = validateVoiceTree([
    { id: "root", parentId: null, name: "Raíz" },
    ...Array.from({ length: 204 }, (_, index) => ({
      id: `child_${index}`, parentId: "root", name: index === 203 ? "Tema remoto" : `Tema ${index}`,
    })),
  ])
  const result = await decideSynthesisVoiceDestination("tema remoto", large, null, async (_state, criteria) => {
    const selected = Object.entries(criteria).find(([, description]) => description.includes("Tema remoto"))?.[0]
    return { choice: selected ?? "n0", probabilities: { [selected ?? "n0"]: 0.96, none: 0.04 } }
  })
  assert.deepEqual(result, { action: "navigate", nodeId: "child_203" })
})

test("rechaza jerarquías inválidas", () => {
  assert.throws(() => validateVoiceTree([{ id: "a", parentId: "missing", name: "A" }]), /inválido/)
  assert.throws(() => validateVoiceTree([{ id: "a", parentId: "b", name: "A" }, { id: "b", parentId: "a", name: "B" }]), /inválido/)
})

test("identifica la última edición real incluso desde el editor completo", () => {
  const before = { type: "doc", content: [
    { type: "heading", attrs: { level: 1, synthesisId: "first" }, content: [{ type: "text", text: "Primero" }] },
    { type: "paragraph", content: [{ type: "text", text: "Inicial" }] },
    { type: "heading", attrs: { level: 2, synthesisId: "second" }, content: [{ type: "text", text: "Segundo" }] },
    { type: "paragraph", content: [{ type: "text", text: "Sin cambio" }] },
  ] }
  const after = structuredClone(before)
  after.content[3].content![0].text = "Actualizado"
  assert.equal(findEditedSynthesisNode(before, after), "second")
  assert.equal(findEditedSynthesisNode(before, before), null)
  const normalized = normalizeSynthesisWorkspace({ version: 2, document: after, layout: {}, lastEditedNodeId: "second" })
  assert.equal(normalized.lastEditedNodeId, "second")
  assert.equal(normalizeSynthesisWorkspace({ ...normalized, lastEditedNodeId: "deleted" }).lastEditedNodeId, undefined)
  assert.equal(removeSynthesisNode(normalized, "second").lastEditedNodeId, undefined)
})

test("la clave del Gateway queda en la ruta de servidor y el modo local la deja pasar", () => {
  const route = readFileSync(new URL("../app/api/synthesis-voice/route.ts", import.meta.url), "utf8")
  const client = readFileSync(new URL("../app/sintesis/synthesis-client.tsx", import.meta.url), "utf8")
  const proxy = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8")
  const interceptor = readFileSync(new URL("../components/local-fetch-interceptor.tsx", import.meta.url), "utf8")
  assert.match(route, /process\.env\.gatewayia/)
  assert.match(route, /requireAuthSession/)
  assert.doesNotMatch(client, /gatewayia/)
  assert.match(proxy, /\/api\/synthesis-voice/)
  assert.match(interceptor, /\/api\/synthesis-voice/)
})
