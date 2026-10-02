export type VoiceTreeNode = { id: string; parentId: string | null; name: string }
export type VoiceCommand = "topics" | "latest_edit" | "edit" | "search"
export type VoiceDestination =
  | { action: "navigate"; nodeId: string }
  | { action: "suggest"; nodeIds: string[] }
  | { action: "none" }

type ChoiceAnswer = { choice?: unknown; probabilities?: unknown }
export type EvaluateChoice = (state: object, criteria: Record<string, string>) => Promise<ChoiceAnswer>

const MAX_OPTIONS = 200

function simplified(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim()
}

export function classifySynthesisVoiceCommand(transcript: string): VoiceCommand {
  const phrase = simplified(transcript)
  if (/^(?:(?:mostra|muestra|mostrar|ver|dime|decime|enseña|ensena)(?:me)? (?:los |la )?)?temas$/.test(phrase)
    || /^(?:que|cuales) (?:temas|componentes) (?:hay|tiene)$/.test(phrase)) return "topics"
  if (/\b(?:ultima edicion|ultimo editado|lo ultimo editado|ultima modificacion)\b/.test(phrase)) return "latest_edit"
  if (/^(?:abre|abrir|abrilo|abrelo|editar|edita)(?: (?:este|esto|el nodo|la vista|aqui))?$/.test(phrase)) return "edit"
  return "search"
}

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

function candidatesFromAnswer(answer: ChoiceAnswer, candidates: VoiceTreeNode[]): VoiceDestination {
  const probabilities = answer.probabilities && typeof answer.probabilities === "object"
    ? answer.probabilities as Record<string, unknown> : {}
  const probability = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0
  const ranked = candidates.map((node, index) => ({
    id: node.id,
    probability: probability(probabilities[`n${index}`]),
  })).sort((a, b) => b.probability - a.probability)
  const selected = typeof answer.choice === "string" && /^n\d+$/.test(answer.choice)
    ? candidates[Number(answer.choice.slice(1))] : null
  const top = ranked.filter((item) => item.probability > 0).slice(0, 3).map((item) => item.id)
  if (!selected) return top.length ? { action: "suggest", nodeIds: top } : { action: "none" }
  const selectedProbability = ranked.find((item) => item.id === selected.id)?.probability ?? 0
  const runnerUp = Math.max(...ranked.filter((item) => item.id !== selected.id).map((item) => item.probability),
    probability(probabilities.none))
  if (selectedProbability < 0.55 || selectedProbability - runnerUp < 0.12) {
    return { action: "suggest", nodeIds: top.length ? top : [selected.id] }
  }
  return { action: "navigate", nodeId: selected.id }
}

async function chooseAmong(
  transcript: string,
  nodes: VoiceTreeNode[],
  candidates: VoiceTreeNode[],
  currentNodeId: string | null,
  evaluate: EvaluateChoice,
): Promise<VoiceDestination> {
  if (candidates.length === 0) return { action: "none" }
  if (candidates.length > MAX_OPTIONS) {
    const groups: VoiceTreeNode[][] = []
    for (let index = 0; index < candidates.length; index += MAX_OPTIONS) groups.push(candidates.slice(index, index + MAX_OPTIONS))
    const criteria: Record<string, string> = { none: "Ningún grupo contiene el tema mencionado." }
    groups.forEach((group, index) => { criteria[`g${index}`] = group.map((node) => voiceNodePath(nodes, node.id)).join("; ") })
    const answer = await evaluate({ transcript, currentPath: currentNodeId ? voiceNodePath(nodes, currentNodeId) : "Inicio" }, criteria)
    const groupIndex = typeof answer.choice === "string" && /^g\d+$/.test(answer.choice) ? Number(answer.choice.slice(1)) : -1
    if (!groups[groupIndex]) return { action: "suggest", nodeIds: candidates.slice(0, 3).map((node) => node.id) }
    return chooseAmong(transcript, nodes, groups[groupIndex], currentNodeId, evaluate)
  }
  const criteria: Record<string, string> = { none: "La frase no se refiere a ninguno de estos nodos." }
  candidates.forEach((node, index) => {
    const children = nodes.filter((child) => child.parentId === node.id).slice(0, 12).map((child) => child.name)
    criteria[`n${index}`] = `${voiceNodePath(nodes, node.id)}${children.length ? `; contiene: ${children.join(", ")}` : ""}`
  })
  const answer = await evaluate({ transcript, currentPath: currentNodeId ? voiceNodePath(nodes, currentNodeId) : "Inicio" }, criteria)
  return candidatesFromAnswer(answer, candidates)
}

export async function decideSynthesisVoiceDestination(
  transcript: string,
  nodes: VoiceTreeNode[],
  currentNodeId: string | null,
  evaluate: EvaluateChoice,
): Promise<VoiceDestination> {
  if (!nodes.length) return { action: "none" }
  if (nodes.length <= MAX_OPTIONS) return chooseAmong(transcript, nodes, nodes, currentNodeId, evaluate)
  let candidates = nodes.filter((node) => node.parentId === null)
  let selected: VoiceDestination = { action: "none" }
  let previousSelectedId: string | null = null
  for (let depth = 0; depth < 12 && candidates.length; depth++) {
    selected = await chooseAmong(transcript, nodes, candidates, currentNodeId, evaluate)
    if (selected.action !== "navigate") return selected
    const selectedNodeId = selected.nodeId
    if (selectedNodeId === previousSelectedId) return selected
    const children = nodes.filter((node) => node.parentId === selectedNodeId)
    if (!children.length) return selected
    candidates = [nodes.find((node) => node.id === selectedNodeId)!, ...children]
    previousSelectedId = selectedNodeId
  }
  return selected
}
