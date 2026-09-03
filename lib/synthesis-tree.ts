export const SYNTHESIS_TREE_VERSION = 1
export const SYNTHESIS_STORAGE_KEY = "inscreen.sintesis.tree.v1"
export const SYNTHESIS_PENDING_KEY = "inscreen.sintesis.pending.v1"
export const SYNTHESIS_MAX_NODES = 200
export const SYNTHESIS_MAX_DEPTH = 12
export const SYNTHESIS_MAX_CHILDREN = 12
export const SYNTHESIS_MAX_NAME = 80
export const SYNTHESIS_MAX_DOCUMENT_BYTES = 1_000_000
export const SYNTHESIS_MIN_SCALE = 0.5
export const SYNTHESIS_MAX_SCALE = 2.4

function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength
}

export type SynthesisNode = {
  id: string
  parentId: string | null
  name: string
  x: number
  y: number
  scale: number
  content: string
}

export type SynthesisTree = {
  version: 1
  revision: number
  updatedAt: string | null
  defaultScale: number
  nodes: Record<string, SynthesisNode>
}

export type SynthesisTreeResponse = {
  ok: true
  tree: SynthesisTree | null
  etag: string | null
}

export type SynthesisSyncState = "loading" | "saving" | "saved" | "pending" | "conflict"

type DraftNode = {
  name: string
  contentLines: string[]
  children: DraftNode[]
}

const VALID_ID = /^[A-Za-z0-9_-]{1,80}$/

export function createEmptySynthesisTree(): SynthesisTree {
  return { version: SYNTHESIS_TREE_VERSION, revision: 0, updatedAt: null, defaultScale: 1, nodes: {} }
}

export function cleanSynthesisName(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, SYNTHESIS_MAX_NAME)
}

function finite(value: unknown, minimum: number, maximum: number, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback
}

export function normalizeSynthesisTree(value: unknown): SynthesisTree {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {}
  const rawNodes = input.nodes && typeof input.nodes === "object" ? input.nodes as Record<string, unknown> : {}
  const tree: SynthesisTree = {
    version: SYNTHESIS_TREE_VERSION,
    revision: Math.max(0, Math.floor(Number(input.revision) || 0)),
    updatedAt: typeof input.updatedAt === "string" && input.updatedAt ? input.updatedAt : null,
    defaultScale: finite(input.defaultScale, SYNTHESIS_MIN_SCALE, SYNTHESIS_MAX_SCALE, 1),
    nodes: {},
  }

  for (const [key, raw] of Object.entries(rawNodes).slice(0, SYNTHESIS_MAX_NODES)) {
    if (!raw || typeof raw !== "object") continue
    const candidate = raw as Record<string, unknown>
    const id = String(candidate.id ?? key)
    const name = cleanSynthesisName(candidate.name)
    if (!VALID_ID.test(id) || !name || tree.nodes[id]) continue
    tree.nodes[id] = {
      id,
      parentId: candidate.parentId == null ? null : String(candidate.parentId),
      name,
      x: finite(candidate.x, 0, 1, 0.5),
      y: finite(candidate.y, 0, 50, 0.5),
      scale: finite(candidate.scale, SYNTHESIS_MIN_SCALE, SYNTHESIS_MAX_SCALE, tree.defaultScale),
      content: typeof candidate.content === "string" ? candidate.content : "",
    }
  }

  for (const node of Object.values(tree.nodes)) {
    if (node.parentId === node.id || (node.parentId !== null && !tree.nodes[node.parentId])) node.parentId = null
    const visited = new Set([node.id])
    let parentId = node.parentId
    while (parentId !== null) {
      if (visited.has(parentId)) {
        node.parentId = null
        break
      }
      visited.add(parentId)
      parentId = tree.nodes[parentId]?.parentId ?? null
    }
  }
  return tree
}

export function assertValidSynthesisTree(value: unknown) {
  if (!value || typeof value !== "object") throw new Error("El árbol de Síntesis es inválido.")
  if (utf8ByteLength(JSON.stringify(value)) > SYNTHESIS_MAX_DOCUMENT_BYTES) {
    throw new Error("El árbol de Síntesis supera el tamaño permitido.")
  }
  const input = value as Record<string, unknown>
  if (!input.nodes || typeof input.nodes !== "object" || Array.isArray(input.nodes)) throw new Error("Faltan los elementos de Síntesis.")
  const entries = Object.entries(input.nodes as Record<string, unknown>)
  if (entries.length > SYNTHESIS_MAX_NODES) throw new Error(`Síntesis admite hasta ${SYNTHESIS_MAX_NODES} elementos.`)
  const rawParents = new Map<string, string | null>()
  for (const [key, raw] of entries) {
    if (!raw || typeof raw !== "object") throw new Error("Hay un elemento de Síntesis inválido.")
    const node = raw as Record<string, unknown>
    const id = String(node.id ?? key)
    const rawName = typeof node.name === "string" ? node.name : ""
    if (!VALID_ID.test(id) || id !== key || !cleanSynthesisName(rawName) || rawName.length > SYNTHESIS_MAX_NAME) throw new Error("Hay un nombre o identificador inválido.")
    rawParents.set(id, node.parentId == null ? null : String(node.parentId))
    if (typeof node.content === "string" && utf8ByteLength(node.content) > 200_000) throw new Error("Una explicación es demasiado extensa.")
  }
  for (const [id, parentId] of rawParents) {
    if (parentId !== null && !rawParents.has(parentId)) throw new Error("Hay una referencia a una carpeta inexistente.")
    const visited = new Set([id])
    let cursor = parentId
    while (cursor !== null) {
      if (visited.has(cursor)) throw new Error("El árbol de Síntesis contiene un ciclo.")
      visited.add(cursor)
      cursor = rawParents.get(cursor) ?? null
    }
  }
  const normalized = normalizeSynthesisTree(value)
  const childCounts = new Map<string | null, number>()
  for (const node of Object.values(normalized.nodes)) {
    childCounts.set(node.parentId, (childCounts.get(node.parentId) ?? 0) + 1)
    let depth = 1
    let parentId = node.parentId
    while (parentId !== null) {
      depth++
      parentId = normalized.nodes[parentId]?.parentId ?? null
    }
    if (depth > SYNTHESIS_MAX_DEPTH) throw new Error(`Síntesis admite hasta ${SYNTHESIS_MAX_DEPTH} niveles.`)
  }
  if ([...childCounts.values()].some(count => count > SYNTHESIS_MAX_CHILDREN)) {
    throw new Error(`Cada elemento admite hasta ${SYNTHESIS_MAX_CHILDREN} hijos.`)
  }
  return normalized
}

export function synthesisChildren(tree: SynthesisTree, parentId: string | null) {
  return Object.values(tree.nodes).filter(node => node.parentId === parentId)
}

export function synthesisPath(tree: SynthesisTree, id: string) {
  const path: string[] = []
  let current: SynthesisNode | undefined = tree.nodes[id]
  while (current) {
    path.unshift(current.name)
    current = current.parentId === null ? undefined : tree.nodes[current.parentId]
  }
  return path
}

function newNodePosition(index: number) {
  return { x: 0.18 + (index % 3) * 0.32, y: 0.2 + Math.floor(index / 3) * 0.24 }
}

export function addSynthesisNode(tree: SynthesisTree, node: Pick<SynthesisNode, "id" | "parentId" | "name" | "x" | "y">) {
  const next = structuredClone(normalizeSynthesisTree(tree))
  if (!VALID_ID.test(node.id) || next.nodes[node.id]) throw new Error("Identificador inválido.")
  if (Object.keys(next.nodes).length >= SYNTHESIS_MAX_NODES) throw new Error("Síntesis alcanzó el máximo de elementos.")
  if (node.parentId !== null && !next.nodes[node.parentId]) throw new Error("La carpeta superior ya no existe.")
  if (synthesisChildren(next, node.parentId).length >= SYNTHESIS_MAX_CHILDREN) throw new Error("Esta carpeta ya tiene doce elementos.")
  const name = cleanSynthesisName(node.name)
  if (!name) throw new Error("Escribí un nombre.")
  next.nodes[node.id] = {
    id: node.id, parentId: node.parentId, name,
    x: finite(node.x, 0, 1, 0.5), y: finite(node.y, 0, 50, 0.5),
    scale: next.defaultScale, content: "",
  }
  return next
}

export function updateSynthesisNode(tree: SynthesisTree, id: string, patch: Partial<Pick<SynthesisNode, "name" | "x" | "y" | "content">>) {
  const next = structuredClone(normalizeSynthesisTree(tree))
  const node = next.nodes[id]
  if (!node) throw new Error("El elemento ya no existe.")
  if (patch.name !== undefined) {
    const name = cleanSynthesisName(patch.name)
    if (!name) throw new Error("Escribí un nombre.")
    node.name = name
  }
  if (patch.x !== undefined) node.x = finite(patch.x, 0, 1, node.x)
  if (patch.y !== undefined) node.y = finite(patch.y, 0, 50, node.y)
  if (patch.content !== undefined) node.content = String(patch.content)
  return next
}

export function scaleSynthesisTree(tree: SynthesisTree, scale: number) {
  const next = structuredClone(normalizeSynthesisTree(tree))
  next.defaultScale = finite(scale, SYNTHESIS_MIN_SCALE, SYNTHESIS_MAX_SCALE, next.defaultScale)
  Object.values(next.nodes).forEach(node => { node.scale = next.defaultScale })
  return next
}

export function synthesisBranchIds(tree: SynthesisTree, id: string) {
  const ids: string[] = []
  const visit = (current: string) => {
    ids.push(current)
    synthesisChildren(tree, current).forEach(child => visit(child.id))
  }
  if (tree.nodes[id]) visit(id)
  return ids
}

export function deleteSynthesisBranch(tree: SynthesisTree, id: string) {
  const next = structuredClone(normalizeSynthesisTree(tree))
  synthesisBranchIds(next, id).forEach(nodeId => delete next.nodes[nodeId])
  return next
}

function trimContent(lines: string[]) {
  while (lines[0]?.trim() === "") lines.shift()
  while (lines.at(-1)?.trim() === "") lines.pop()
  return lines.join("\n")
}

export function serializeSynthesisBranch(tree: SynthesisTree, rootId: string) {
  const root = tree.nodes[rootId]
  if (!root) return ""
  const lines: string[] = []
  if (root.content) lines.push(root.content.trimEnd())
  const writeDescendants = (parentId: string, depth: number) => {
    synthesisChildren(tree, parentId).forEach(child => {
      if (lines.length && lines.at(-1) !== "") lines.push("")
      lines.push(depth === 1 ? `# ${child.name}` : `${"  ".repeat(depth - 2)}- ${child.name}`)
      if (child.content) lines.push(child.content.trimEnd())
      writeDescendants(child.id, depth + 1)
    })
  }
  writeDescendants(rootId, 1)
  return lines.join("\n").trim()
}

export function serializeSynthesisTree(tree: SynthesisTree) {
  const lines: string[] = []
  const writeNode = (node: SynthesisNode, depth: number) => {
    if (lines.length && lines.at(-1) !== "") lines.push("")
    lines.push(depth === 1 ? `# ${node.name}` : `${"  ".repeat(depth - 2)}- ${node.name}`)
    if (node.content) lines.push(node.content.trimEnd())
    synthesisChildren(tree, node.id).forEach(child => writeNode(child, depth + 1))
  }
  synthesisChildren(tree, null).forEach(node => writeNode(node, 1))
  return lines.join("\n").trim()
}

function parseStructuredMarkdown(source: string) {
  const root: DraftNode = { name: "", contentLines: [], children: [] }
  const headingStack: DraftNode[] = [root]
  const bulletStack: DraftNode[] = []
  let current = root
  for (const line of String(source).replace(/\r\n?/g, "\n").split("\n")) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
    if (heading) {
      const level = heading[1].length
      const node: DraftNode = { name: cleanSynthesisName(heading[2]), contentLines: [], children: [] }
      const parent = headingStack[level - 1] ?? root
      parent.children.push(node)
      headingStack.length = level
      headingStack[level] = node
      bulletStack.length = 0
      current = node
      continue
    }
    const bullet = /^(\s*)[-+*]\s+(.+?)\s*$/.exec(line)
    if (bullet) {
      const indent = Math.min(SYNTHESIS_MAX_DEPTH - 1, Math.floor(bullet[1].replace(/\t/g, "  ").length / 2))
      const node: DraftNode = { name: cleanSynthesisName(bullet[2]), contentLines: [], children: [] }
      const headingParent = [...headingStack].reverse().find(Boolean) ?? root
      const parent = indent === 0 ? headingParent : bulletStack[indent - 1] ?? headingParent
      parent.children.push(node)
      bulletStack.length = indent
      bulletStack[indent] = node
      current = node
      continue
    }
    current.contentLines.push(line)
  }
  return root
}

export function applyStructuredMarkdown(tree: SynthesisTree, rootId: string, source: string, idFactory: () => string) {
  const next = structuredClone(normalizeSynthesisTree(tree))
  const rootNode = next.nodes[rootId]
  if (!rootNode) throw new Error("El elemento ya no existe.")
  const draft = parseStructuredMarkdown(source)
  rootNode.content = trimContent(draft.contentLines)
  const oldTree = normalizeSynthesisTree(tree)
  const usedIds = new Set([rootId])
  let count = 1

  const materialize = (items: DraftNode[], parentId: string, depth: number) => {
    if (items.length > SYNTHESIS_MAX_CHILDREN) throw new Error("Una sección supera los doce elementos.")
    if (depth > SYNTHESIS_MAX_DEPTH) throw new Error("El esquema supera los doce niveles.")
    const oldChildren = synthesisChildren(oldTree, parentId)
    items.forEach((item, index) => {
      if (!item.name) return
      if (++count > SYNTHESIS_MAX_NODES) throw new Error("El esquema supera los doscientos elementos.")
      const old = oldChildren.find(candidate => !usedIds.has(candidate.id) && candidate.name === item.name)
        ?? (oldChildren[index] && !usedIds.has(oldChildren[index].id) ? oldChildren[index] : undefined)
      const id = old?.id ?? idFactory()
      usedIds.add(id)
      const position = old ?? newNodePosition(index)
      next.nodes[id] = {
        id, parentId, name: item.name, x: position.x, y: position.y,
        scale: old?.scale ?? next.defaultScale, content: trimContent(item.contentLines),
      }
      materialize(item.children, id, depth + 1)
    })
  }
  materialize(draft.children, rootId, 2)
  synthesisBranchIds(oldTree, rootId).slice(1).forEach(id => {
    if (!usedIds.has(id)) delete next.nodes[id]
  })
  return assertValidSynthesisTree(next)
}

export function applyStructuredMarkdownTree(tree: SynthesisTree, source: string, idFactory: () => string) {
  const next = structuredClone(normalizeSynthesisTree(tree))
  const oldTree = normalizeSynthesisTree(tree)
  const draft = parseStructuredMarkdown(source)
  if (trimContent([...draft.contentLines])) {
    throw new Error("El esquema completo debe comenzar con un título de tema.")
  }

  const usedIds = new Set<string>()
  let count = 0
  const materialize = (items: DraftNode[], parentId: string | null, depth: number) => {
    if (items.length > SYNTHESIS_MAX_CHILDREN) throw new Error("Una sección supera los doce elementos.")
    if (depth > SYNTHESIS_MAX_DEPTH) throw new Error("El esquema supera los doce niveles.")
    const oldChildren = synthesisChildren(oldTree, parentId)

    items.forEach((item, index) => {
      if (!item.name) return
      if (++count > SYNTHESIS_MAX_NODES) throw new Error("El esquema supera los doscientos elementos.")
      const old = oldChildren.find(candidate => !usedIds.has(candidate.id) && candidate.name === item.name)
        ?? (oldChildren[index] && !usedIds.has(oldChildren[index].id) ? oldChildren[index] : undefined)
      const id = old?.id ?? idFactory()
      usedIds.add(id)
      const position = old ?? newNodePosition(index)
      next.nodes[id] = {
        id,
        parentId,
        name: item.name,
        x: position.x,
        y: position.y,
        scale: old?.scale ?? next.defaultScale,
        content: trimContent(item.contentLines),
      }
      materialize(item.children, id, depth + 1)
    })
  }

  materialize(draft.children, null, 1)
  Object.keys(oldTree.nodes).forEach(id => {
    if (!usedIds.has(id)) delete next.nodes[id]
  })
  return assertValidSynthesisTree(next)
}
