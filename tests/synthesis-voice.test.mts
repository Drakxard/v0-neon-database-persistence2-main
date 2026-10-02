import assert from "node:assert/strict"
import test from "node:test"
import {
  decideSynthesisVoiceDestination,
  validateVoiceTree,
  voiceNodePath,
} from "../lib/synthesis-voice-navigation.ts"
import { findEditedSynthesisNode, normalizeSynthesisWorkspace } from "../lib/synthesis-workspace.ts"
import { removeSynthesisNode } from "../lib/synthesis-material-links.ts"
import { summarizeGatewayFailure } from "../lib/jev-gateway-diagnostics.ts"
import { readFileSync } from "node:fs"

const nodes = validateVoiceTree([
  { id: "calculo", parentId: null, name: "Cálculo" },
  { id: "integrales", parentId: "calculo", name: "Integrales" },
  { id: "definidas", parentId: "integrales", name: "Integrales definidas" },
  { id: "derivadas", parentId: "calculo", name: "Derivadas" },
])

test("Jev decide los comandos y el nodo en la misma evaluación", async () => {
  const topics = await decideSynthesisVoiceDestination("mostrame los temas", nodes, null, null, async (_state, questions) => {
    const criteria = questions.destination.criteria
    assert.ok(criteria.topics)
    assert.ok(criteria.edit)
    assert.ok(criteria.n2)
    return { destination: { choice: "topics", probabilities: { topics: 0.95, edit: 0.02, none: 0.03 } } }
  })
  assert.deepEqual(topics, { action: "topics" })
  const edit = await decideSynthesisVoiceDestination("quiero modificar esto", nodes, null, null, async () => ({ destination: {
    choice: "edit", probabilities: { edit: 0.93, topics: 0.02, none: 0.05 } },
  }))
  assert.deepEqual(edit, { action: "edit" })
  const latest = await decideSynthesisVoiceDestination("volvé a lo que cambié recién", nodes, null, "derivadas", async (_state, questions) => {
    const criteria = questions.destination.criteria
    assert.ok(criteria.latest)
    return { destination: { choice: "latest", probabilities: { latest: 0.9, none: 0.1 } } }
  })
  assert.deepEqual(latest, { action: "navigate", nodeId: "derivadas" })
  const empty = await decideSynthesisVoiceDestination("temas", [], null, null, async () => ({ destination: {
    choice: "topics", probabilities: { topics: 1 } },
  }))
  assert.deepEqual(empty, { action: "topics" })
  assert.equal(voiceNodePath(nodes, "definidas"), "Cálculo > Integrales > Integrales definidas")
})

test("la elección de Jev determina directamente la navegación o la inacción", async () => {
  const chosen = await decideSynthesisVoiceDestination("integrales definidas", nodes, null, null, async (_state, questions) => {
    const criteria = questions.destination.criteria
    assert.match(criteria.n2, /Integrales definidas/)
    return { destination: { choice: "n2", probabilities: { n2: 0.9, n1: 0.06, none: 0.04 } } }
  })
  assert.deepEqual(chosen, { action: "navigate", nodeId: "definidas" })

  const selected = await decideSynthesisVoiceDestination("integral", nodes, null, null, async () => ({ destination: {
    choice: "n1", probabilities: { n1: 0.49, n2: 0.45, none: 0.06 } },
  }))
  assert.deepEqual(selected, { action: "navigate", nodeId: "integrales" })

  const none = await decideSynthesisVoiceDestination("seguí escuchando", nodes, null, null, async () => ({ destination: {
    choice: "none", probabilities: { none: 0.51, n1: 0.49 } },
  }))
  assert.deepEqual(none, { action: "none" })

  const invalid = await decideSynthesisVoiceDestination("derivadas", nodes, null, null, async () => ({ destination: {
    choice: "n999", probabilities: { n3: 0.98 } },
  }))
  assert.deepEqual(invalid, { action: "none" })
})

test("árboles grandes conservan el acceso a nodos fuera del primer grupo", async () => {
  const large = validateVoiceTree([
    { id: "root", parentId: null, name: "Raíz" },
    ...Array.from({ length: 204 }, (_, index) => ({
      id: `child_${index}`, parentId: "root", name: index === 203 ? "Tema remoto" : `Tema ${index}`,
    })),
  ])
  let calls = 0
  const result = await decideSynthesisVoiceDestination("tema remoto", large, null, null, async (_state, questions) => {
    calls += 1
    const group = Object.entries(questions.group.criteria).find(([, description]) => description.includes("Tema remoto"))?.[0]
    assert.equal(group, "g1")
    const selected = Object.entries(questions.nodes1.criteria).find(([, description]) => description.includes("Tema remoto"))?.[0]
    return {
      group: { choice: group, probabilities: { [group]: 0.96, none: 0.04 } },
      nodes0: { choice: "none", probabilities: { none: 1 } },
      nodes1: { choice: selected, probabilities: { [selected]: 0.96, none: 0.04 } },
    }
  })
  assert.equal(calls, 1)
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
  assert.doesNotMatch(route, /process\.env\.AI_GATEWAY_API_KEY/)
  assert.doesNotMatch(route, /DeniedUntil|resolveSynthesisVoiceLocally/)
  assert.match(route, /requireAuthSession/)
  assert.doesNotMatch(client, /gatewayia/)
  assert.doesNotMatch(client, /VOICE_ERROR_PREFIX/)
  assert.doesNotMatch(client, /classifySynthesisVoiceCommand|matchLocalVoiceDestination/)
  assert.match(proxy, /\/api\/synthesis-voice/)
  assert.match(interceptor, /\/api\/synthesis-voice/)
})

test("un rechazo de Gateway conserva el código y el ID sin registrar la clave", () => {
  const response = new Response(null, { status: 403, headers: { "x-vercel-id": "iad1::test" } })
  const failure = summarizeGatewayFailure(response,
    '{"error":{"type":"access_denied","message":"Forbidden for secret-key"}}', ["secret-key"])
  assert.deepEqual(failure, {
    status: 403,
    code: "access_denied",
    requestId: "iad1::test",
    response: '{"error":{"type":"access_denied","message":"Forbidden for [redacted]"}}',
  })
  assert.deepEqual(summarizeGatewayFailure(new Response(null, { status: 403 }), "", ["secret-key"]), {
    status: 403,
    code: null,
    requestId: null,
    response: "",
  })
})
