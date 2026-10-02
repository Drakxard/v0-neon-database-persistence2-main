export type VoiceTreeNode = { id: string; parentId: string | null; name: string }
export type VoiceDestination =
  | { action: "navigate"; nodeId: string }
  | { action: "suggest"; nodeIds: string[] }
  | { action: "topics" }
  | { action: "edit" }
  | { action: "none" }

type ChoiceAnswer = { choice?: unknown; probabilities?: unknown }
type ChoiceQuestion = { type: "choice"; instructions: string; criteria: Record<string, string> }
export type EvaluateChoices = (state: object, questions: Record<string, ChoiceQuestion>) => Promise<Record<string, ChoiceAnswer>>

const MAX_OPTIONS = 200

export function validateVoiceTree(input: unknown): VoiceTreeNode[] {
  if (!Array.isArray(input) || input.length > 500) throw new Error("Árbol de Síntesis inválido.")
  const nodes: VoiceTreeNode[] = []
  const ids = new Set<string>()
  for (const item of input) {
    if (!item || typeof item !== "object") throw new Error("Árbol de Síntesis inválido.")
    const value = item as Partial<VoiceTreeNode>
    if (typeof value.id !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(value.id) || ids.has(value.id)
      || typeof value.name !== "string" || !value.name.trim() || value.name.length > 300
      || !(value.parentId === null || typeof value.parentId === "string")) throw new Error("Árbol de Síntesis inválido.")
    ids.add(value.id)
    nodes.push({ id: value.id, parentId: value.parentId, name: value.name.trim() })
  }
  for (const node of nodes) {
    if (node.parentId !== null && !ids.has(node.parentId)) throw new Error("Árbol de Síntesis inválido.")
    const seen = new Set([node.id])
    let ancestor = node.parentId
    while (ancestor !== null) {
      if (seen.has(ancestor)) throw new Error("Árbol de Síntesis inválido.")
      seen.add(ancestor)
      ancestor = nodes.find((candidate) => candidate.id === ancestor)?.parentId ?? null
    }
  }
  return nodes
}

export function voiceNodePath(nodes: VoiceTreeNode[], nodeId: string): string {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const names: string[] = []
  let node = byId.get(nodeId)
  while (node) {
    names.unshift(node.name)
    node = node.parentId ? byId.get(node.parentId) : undefined
  }
  return names.join(" > ")
}

function commandCriteria(lastEditedNodeId: string | null): Record<string, string> {
  return {
    topics: "Quiere ver la jerarquía o el índice navegable de temas, sin elegir todavía un nodo concreto.",
    edit: "Quiere abrir el editor de la ubicación actual, igual que pulsar el lápiz de la esquina superior.",
    ...(lastEditedNodeId ? { latest: "Quiere ir al nodo cuyo contenido fue editado más recientemente." } : {}),
    none: "No pide navegar a un nodo, ver la jerarquía ni abrir el editor.",
  }
}

function candidatesFromAnswer(answer: ChoiceAnswer, candidates: VoiceTreeNode[], lastEditedNodeId: string | null): VoiceDestination {
  const probabilities = answer.probabilities && typeof answer.probabilities === "object"
    ? answer.probabilities as Record<string, unknown> : {}
  const probability = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0
  const ranked = candidates.map((node, index) => ({
    id: node.id,
    probability: probability(probabilities[`n${index}`]),
  })).sort((a, b) => b.probability - a.probability)
  const choice = typeof answer.choice === "string" ? answer.choice : ""
  const selected = /^n\d+$/.test(choice) ? candidates[Number(choice.slice(1))] : null
  const top = ranked.filter((item) => item.probability > 0).slice(0, 3).map((item) => item.id)
  if (choice === "none") return { action: "none" }
  if (!selected && choice !== "topics" && choice !== "edit" && !(choice === "latest" && lastEditedNodeId)) {
    return top.length ? { action: "suggest", nodeIds: top } : { action: "none" }
  }
  const selectedProbability = probability(probabilities[choice])
  const runnerUp = Math.max(0, ...Object.entries(probabilities)
    .filter(([key]) => key !== choice)
    .map(([, value]) => probability(value)))
  if (selectedProbability < 0.55 || selectedProbability - runnerUp < 0.12) {
    return top.length ? { action: "suggest", nodeIds: top } : { action: "none" }
  }
  if (choice === "topics") return { action: "topics" }
  if (choice === "edit") return { action: "edit" }
  if (choice === "latest" && lastEditedNodeId) return { action: "navigate", nodeId: lastEditedNodeId }
  if (!selected) return { action: "none" }
  return { action: "navigate", nodeId: selected.id }
}

export async function decideSynthesisVoiceDestination(
  transcript: string,
  nodes: VoiceTreeNode[],
  currentNodeId: string | null,
  lastEditedNodeId: string | null,
  evaluate: EvaluateChoices,
): Promise<VoiceDestination> {
  const state = {
    transcript,
    currentPath: currentNodeId ? voiceNodePath(nodes, currentNodeId) : "Inicio",
    lastEditedPath: lastEditedNodeId ? voiceNodePath(nodes, lastEditedNodeId) : null,
  }
  const nodeCriteria = (group: VoiceTreeNode[]) => Object.fromEntries(group.map((node, index) => [
    `n${index}`, voiceNodePath(nodes, node.id).slice(-120),
  ]))
  if (nodes.length <= MAX_OPTIONS) {
    const questions: Record<string, ChoiceQuestion> = {
      destination: {
        type: "choice",
        instructions: "Decide en una sola elección qué acción pide la frase en español. Para navegar, elige el nodo más específico que coincida semánticamente; no exige repetir su nombre exacto.",
        criteria: { ...commandCriteria(lastEditedNodeId), ...nodeCriteria(nodes) },
      },
    }
    const answers = await evaluate(state, questions)
    return candidatesFromAnswer(answers.destination ?? {}, nodes, lastEditedNodeId)
  }
  const groups: VoiceTreeNode[][] = []
  for (let index = 0; index < nodes.length; index += MAX_OPTIONS) groups.push(nodes.slice(index, index + MAX_OPTIONS))
  const groupCriteria = commandCriteria(lastEditedNodeId)
  const questions: Record<string, ChoiceQuestion> = {}
  groups.forEach((group, index) => {
    groupCriteria[`g${index}`] = group.map((node) => voiceNodePath(nodes, node.id).slice(-60)).join("; ")
    questions[`nodes${index}`] = {
      type: "choice",
      instructions: "Si la frase pide navegar a un nodo de este grupo, elige el más específico. Si no está aquí, elige none.",
      criteria: { none: "El destino no está en este grupo.", ...nodeCriteria(group) },
    }
  })
  questions.group = {
    type: "choice",
    instructions: "Decide si la frase pide ver temas, editar, ir a la última edición o navegar a uno de los grupos de nodos. Elige none si no pide ninguna acción.",
    criteria: groupCriteria,
  }
  const answers = await evaluate(state, questions)
  const groupAnswer = answers.group ?? {}
  if (groupAnswer.choice === "topics" || groupAnswer.choice === "edit" || groupAnswer.choice === "latest" || groupAnswer.choice === "none") {
    return candidatesFromAnswer(groupAnswer, [], lastEditedNodeId)
  }
  const groupIndex = typeof groupAnswer.choice === "string" && /^g\d+$/.test(groupAnswer.choice)
    ? Number(groupAnswer.choice.slice(1)) : -1
  if (!groups[groupIndex]) return { action: "none" }
  const destination = candidatesFromAnswer(answers[`nodes${groupIndex}`] ?? {}, groups[groupIndex], null)
  const probabilities = groupAnswer.probabilities && typeof groupAnswer.probabilities === "object"
    ? groupAnswer.probabilities as Record<string, unknown> : {}
  const probability = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0
  const selectedProbability = probability(probabilities[`g${groupIndex}`])
  const runnerUp = Math.max(0, ...Object.entries(probabilities)
    .filter(([key]) => key !== `g${groupIndex}`)
    .map(([, value]) => probability(value)))
  if (selectedProbability < 0.55 || selectedProbability - runnerUp < 0.12) {
    return destination.action === "navigate" ? { action: "suggest", nodeIds: [destination.nodeId] } : destination
  }
  return destination
}
