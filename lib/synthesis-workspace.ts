export const SYNTHESIS_WORKSPACE_VERSION = 2 as const
export const SYNTHESIS_WORKSPACE_STORAGE_KEY = "inscreen:synthesis:workspace-v2"
export const SYNTHESIS_WORKSPACE_PENDING_KEY = "inscreen:synthesis:pending-v2"
export const SYNTHESIS_MAX_DOCUMENT_BYTES = 1_000_000
export const SYNTHESIS_MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const SYNTHESIS_LOCAL_IMAGE_PREFIX = "synthesis-local-image:"

export type TiptapJSON = {
  type?: string
  attrs?: Record<string, unknown>
  content?: TiptapJSON[]
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>
  text?: string
  [key: string]: unknown
}

export type SynthesisNodeLayout = { x: number; y: number; scale: number }

export type SynthesisWorkspaceV2 = {
  version: typeof SYNTHESIS_WORKSPACE_VERSION
  revision: number
  updatedAt: string
  defaultScale: number
  document: TiptapJSON
  layout: Record<string, SynthesisNodeLayout>
}

export type DerivedSynthesisNode = {
  id: string
  parentId: string | null
  name: string
  kind: "heading" | "listItem" | "taskItem"
  level: number
  body: TiptapJSON[]
  source: TiptapJSON
}

const STRUCTURAL_TYPES = new Set(["heading", "listItem", "taskItem"])
const LIST_TYPES = new Set(["bulletList", "orderedList", "taskList"])
const IMAGE_TYPES = new Set(["image"])

export function createSynthesisId() {
  return globalThis.crypto?.randomUUID?.() ?? `syn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
}

export function createEmptySynthesisWorkspace(): SynthesisWorkspaceV2 {
  return {
    version: SYNTHESIS_WORKSPACE_VERSION,
    revision: 0,
    updatedAt: new Date(0).toISOString(),
    defaultScale: 1,
    document: { type: "doc", content: [] },
    layout: {},
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function plainText(node: TiptapJSON | undefined): string {
  if (!node) return ""
  if (typeof node.text === "string") return node.text
  return (node.content ?? []).map(plainText).join("").trim()
}

function structuralId(node: TiptapJSON) {
  const value = node.attrs?.synthesisId
  return typeof value === "string" && value.trim() ? value : null
}

export function ensureSynthesisDocument(
  input: unknown,
  idFactory: () => string = createSynthesisId
): TiptapJSON {
  const candidate = clone(input && typeof input === "object" ? input : { type: "doc", content: [] }) as TiptapJSON
  candidate.type = "doc"
  candidate.content = Array.isArray(candidate.content) ? candidate.content : []

  const firstHeading = candidate.content.findIndex((node) => node?.type === "heading")
  if (candidate.content.length && firstHeading !== 0) {
    const orphanEnd = firstHeading < 0 ? candidate.content.length : firstHeading
    const orphan = candidate.content.splice(0, orphanEnd)
    candidate.content.unshift(
      { type: "heading", attrs: { level: 1, synthesisId: idFactory() }, content: [{ type: "text", text: "Sin título" }] },
      ...orphan
    )
  }

  const seen = new Set<string>()
  const visit = (node: TiptapJSON) => {
    if (STRUCTURAL_TYPES.has(node.type ?? "")) {
      const existing = structuralId(node)
      const id = existing && !seen.has(existing) ? existing : idFactory()
      node.attrs = { ...(node.attrs ?? {}), synthesisId: id }
      seen.add(id)
    }
    for (const child of node.content ?? []) visit(child)
  }
  visit(candidate)
  return candidate
}

function firstLabelBlock(node: TiptapJSON) {
  return (node.content ?? []).find((child) => !LIST_TYPES.has(child.type ?? ""))
}

export function deriveSynthesisNodes(documentInput: TiptapJSON): DerivedSynthesisNode[] {
  const document = ensureSynthesisDocument(documentInput)
  const nodes: DerivedSynthesisNode[] = []
  const headings: Array<{ id: string; level: number }> = []
  let activeHeadingId: string | null = null

  const addList = (list: TiptapJSON, parentId: string | null, depth: number) => {
    for (const item of list.content ?? []) {
      if (item.type !== "listItem" && item.type !== "taskItem") continue
      const id = structuralId(item)!
      const label = plainText(firstLabelBlock(item)) || "Sin título"
      const labelBlock = firstLabelBlock(item)
      const body = (item.content ?? []).filter((child) => child !== labelBlock && !LIST_TYPES.has(child.type ?? ""))
      nodes.push({ id, parentId, name: label, kind: item.type, level: depth, body, source: item })
      for (const child of item.content ?? []) if (LIST_TYPES.has(child.type ?? "")) addList(child, id, depth + 1)
    }
  }

  for (const block of document.content ?? []) {
    if (block.type === "heading") {
      const level = Math.max(1, Math.min(3, Number(block.attrs?.level) || 1))
      while (headings.length && headings[headings.length - 1].level >= level) headings.pop()
      const id = structuralId(block)!
      const parentId = headings.at(-1)?.id ?? null
      nodes.push({ id, parentId, name: plainText(block) || "Sin título", kind: "heading", level, body: [], source: block })
      headings.push({ id, level })
      activeHeadingId = id
      continue
    }
    if (LIST_TYPES.has(block.type ?? "")) {
      addList(block, activeHeadingId, (headings.at(-1)?.level ?? 0) + 1)
      continue
    }
    if (activeHeadingId) nodes.find((node) => node.id === activeHeadingId)?.body.push(block)
  }
  return nodes
}

export function reconcileSynthesisLayout(
  nodes: DerivedSynthesisNode[],
  layout: Record<string, SynthesisNodeLayout>,
  defaultScale = 1
) {
  const next: Record<string, SynthesisNodeLayout> = {}
  const siblingCounts = new Map<string, number>()
  for (const node of nodes) {
    if (layout[node.id]) {
      next[node.id] = layout[node.id]
      continue
    }
    const key = node.parentId ?? "root"
    const index = siblingCounts.get(key) ?? 0
    siblingCounts.set(key, index + 1)
    next[node.id] = { x: 0.22 + (index % 4) * 0.19, y: 0.28 + Math.floor(index / 4) * 0.24, scale: defaultScale }
  }
  return next
}

export function normalizeSynthesisWorkspace(input: unknown): SynthesisWorkspaceV2 {
  const value = input && typeof input === "object" ? input as Partial<SynthesisWorkspaceV2> : {}
  const document = ensureSynthesisDocument(value.document)
  const defaultScale = Math.max(0.5, Math.min(2, Number(value.defaultScale) || 1))
  const rawLayout = value.layout && typeof value.layout === "object" ? value.layout : {}
  const layout: Record<string, SynthesisNodeLayout> = {}
  for (const [id, position] of Object.entries(rawLayout)) {
    if (!position || typeof position !== "object") continue
    const p = position as Partial<SynthesisNodeLayout>
    if ([p.x, p.y, p.scale].every(Number.isFinite)) layout[id] = {
      x: Math.max(0, Math.min(1, Number(p.x))), y: Math.max(0.1, Math.min(4, Number(p.y))), scale: Math.max(0.5, Math.min(2, Number(p.scale))),
    }
  }
  const nodes = deriveSynthesisNodes(document)
  return {
    version: SYNTHESIS_WORKSPACE_VERSION,
    revision: Math.max(0, Math.floor(Number(value.revision) || 0)),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString(),
    defaultScale,
    document,
    layout: reconcileSynthesisLayout(nodes, layout, defaultScale),
  }
}

export function assertValidSynthesisWorkspace(input: unknown) {
  const serialized = JSON.stringify(input)
  if (new TextEncoder().encode(serialized).byteLength > SYNTHESIS_MAX_DOCUMENT_BYTES) throw new Error("La Síntesis es demasiado grande.")
  if (/\b(?:data:image\/|blob:)/i.test(serialized)) throw new Error("Las imágenes deben guardarse como referencias locales.")
  const workspace = normalizeSynthesisWorkspace(input)
  if (deriveSynthesisNodes(workspace.document).length > 500) throw new Error("La Síntesis tiene demasiados nodos.")
  return workspace
}

export function childrenOf(nodes: DerivedSynthesisNode[], parentId: string | null) {
  return nodes.filter((node) => node.parentId === parentId)
}

export function scaleSynthesisWorkspace(workspace: SynthesisWorkspaceV2, scale: number) {
  const nextScale = Math.round(Math.max(0.5, Math.min(2, scale)) * 10) / 10
  return { ...workspace, defaultScale: nextScale, layout: Object.fromEntries(Object.entries(workspace.layout).map(([id, value]) => [id, { ...value, scale: nextScale }])) }
}

function listContainsId(node: TiptapJSON, id: string): boolean {
  if (structuralId(node) === id) return true
  return (node.content ?? []).some((child) => listContainsId(child, id))
}

export function extractSynthesisBranchDocument(documentInput: TiptapJSON, id: string): TiptapJSON {
  const document = ensureSynthesisDocument(documentInput)
  const blocks = document.content ?? []
  const headingIndex = blocks.findIndex((node) => node.type === "heading" && structuralId(node) === id)
  if (headingIndex >= 0) {
    const level = Number(blocks[headingIndex].attrs?.level) || 1
    let end = headingIndex + 1
    while (end < blocks.length && !(blocks[end].type === "heading" && (Number(blocks[end].attrs?.level) || 1) <= level)) end++
    return { type: "doc", content: clone(blocks.slice(headingIndex, end)) }
  }
  const findListItem = (node: TiptapJSON): TiptapJSON | null => {
    if ((node.type === "listItem" || node.type === "taskItem") && structuralId(node) === id) return node
    for (const child of node.content ?? []) { const found = findListItem(child); if (found) return found }
    return null
  }
  for (const block of blocks) {
    if (!listContainsId(block, id)) continue
    const item = findListItem(block)
    if (item) {
      const wrapperType = item.type === "taskItem" ? "taskList" : block.type === "orderedList" ? "orderedList" : "bulletList"
      return { type: "doc", content: [{ type: wrapperType, content: [clone(item)] }] }
    }
  }
  return { type: "doc", content: [] }
}

export function replaceSynthesisBranch(documentInput: TiptapJSON, id: string, branchInput: TiptapJSON): TiptapJSON {
  const document = ensureSynthesisDocument(documentInput)
  const branch = ensureSynthesisDocument(branchInput)
  const blocks = document.content ?? []
  const headingIndex = blocks.findIndex((node) => node.type === "heading" && structuralId(node) === id)
  if (headingIndex >= 0) {
    const level = Number(blocks[headingIndex].attrs?.level) || 1
    let end = headingIndex + 1
    while (end < blocks.length && !(blocks[end].type === "heading" && (Number(blocks[end].attrs?.level) || 1) <= level)) end++
    blocks.splice(headingIndex, end - headingIndex, ...(branch.content ?? []))
    return ensureSynthesisDocument(document)
  }
  const replacement = (branch.content ?? []).flatMap((node) => LIST_TYPES.has(node.type ?? "") ? node.content ?? [] : []).find((node) => node.type === "listItem" || node.type === "taskItem")
  const visit = (node: TiptapJSON): boolean => {
    const children = node.content ?? []
    const index = children.findIndex((child) => structuralId(child) === id)
    if (index >= 0) { if (replacement) children.splice(index, 1, clone(replacement)); else children.splice(index, 1); return true }
    return children.some(visit)
  }
  visit(document)
  return ensureSynthesisDocument(document)
}

export function nodeReadingDocument(node: DerivedSynthesisNode): TiptapJSON {
  return { type: "doc", content: clone(node.body) }
}

export function referencedLocalImageIds(document: TiptapJSON) {
  const ids = new Set<string>()
  const visit = (node: TiptapJSON) => {
    if (IMAGE_TYPES.has(node.type ?? "")) {
      const src = typeof node.attrs?.src === "string" ? node.attrs.src : ""
      if (src.startsWith(SYNTHESIS_LOCAL_IMAGE_PREFIX)) ids.add(src.slice(SYNTHESIS_LOCAL_IMAGE_PREFIX.length))
    }
    for (const child of node.content ?? []) visit(child)
  }
  visit(document)
  return [...ids]
}
