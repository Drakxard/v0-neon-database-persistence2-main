import {
  createSynthesisId, deriveSynthesisNodes, ensureSynthesisDocument, normalizeSynthesisWorkspace,
  plainText, type SynthesisWorkspaceV2, type TiptapJSON, type SynthesisSourceLink,
} from "./synthesis-workspace.ts"

type Container = { id: number; name: string; kind: string; orderIndex: number }
type Material = { id: number; file_name: string; container_id: number | null; material_type: string; order_index: number }

export const synthesisPdfTitle = (name: string) => name.replace(/\.pdf$/i, "")

/** Keep source identities outside the editor document, so changing a heading never unlinks a PDF. */
export function recordSynthesisRemovals(previous: SynthesisWorkspaceV2, document: TiptapJSON): SynthesisWorkspaceV2 {
  const next = normalizeSynthesisWorkspace({ ...previous, document })
  if (!next.sources) return next
  const ids = new Set(deriveSynthesisNodes(next.document).map((node) => node.id))
  const previousIds = new Set(deriveSynthesisNodes(previous.document).map((node) => node.id))
  for (const link of Object.values(next.sources.containers)) {
    const wasPresent = previousIds.has(link.nodeId)
    if (wasPresent && !ids.has(link.nodeId)) {
      link.dismissed = true
      for (const material of Object.values(next.sources.materials)) {
        if (material.containerId !== undefined && next.sources.containers[String(material.containerId)]?.nodeId === link.nodeId
          && !ids.has(material.nodeId)) material.dismissed = true
      }
    } else if (ids.has(link.nodeId)) link.dismissed = false
  }
  for (const link of Object.values(next.sources.materials)) link.dismissed = !ids.has(link.nodeId)
  return next
}

export function removeSynthesisNode(workspace: SynthesisWorkspaceV2, nodeId: string) {
  const document = ensureSynthesisDocument(workspace.document)
  const blocks = document.content ?? []
  const index = blocks.findIndex((block) => block.type === "heading" && block.attrs?.synthesisId === nodeId)
  if (index >= 0) {
    const level = Number(blocks[index].attrs?.level) || 1
    let end = index + 1
    while (end < blocks.length && !(blocks[end].type === "heading" && Number(blocks[end].attrs?.level) <= level)) end++
    blocks.splice(index, end - index)
  } else {
    const visit = (node: TiptapJSON) => {
      node.content = node.content?.filter((child) => child.attrs?.synthesisId !== nodeId)
      node.content?.forEach(visit)
    }
    visit(document)
  }
  return recordSynthesisRemovals(workspace, document)
}

function renameAutomaticHeading(document: TiptapJSON, link: SynthesisSourceLink, title: string) {
  const visit = (node: TiptapJSON) => {
    if (node.attrs?.synthesisId === link.nodeId && node.type === "heading" && plainText(node) === link.autoTitle) {
      node.content = [{ type: "text", text: title }]
    }
    node.content?.forEach(visit)
  }
  visit(document)
  link.autoTitle = title
}

export function renameSynthesisMaterial(workspace: SynthesisWorkspaceV2, materialId: number, fileName: string) {
  const next = normalizeSynthesisWorkspace(workspace)
  const link = next.sources?.materials[String(materialId)]
  if (link) renameAutomaticHeading(next.document, link, synthesisPdfTitle(fileName))
  return next
}

export function hasSynthesisMaterialDevelopment(workspace: SynthesisWorkspaceV2, materialId: number) {
  const link = workspace.sources?.materials[String(materialId)]
  if (!link || link.dismissed) return false
  const nodes = deriveSynthesisNodes(workspace.document)
  const node = nodes.find((candidate) => candidate.id === link.nodeId)
  if (!node) return false
  const meaningful = (block: TiptapJSON): boolean => {
    if (block.type === "paragraph" || block.type === "text" || block.type === "hardBreak") {
      return Boolean(plainText(block).trim()) || (block.content ?? []).some(meaningful)
    }
    return true
  }
  return node.name !== link.autoTitle || node.body.some(meaningful) || nodes.some((child) => child.parentId === node.id)
}

export function removeSynthesisMaterial(workspace: SynthesisWorkspaceV2, materialId: number) {
  const link = workspace.sources?.materials[String(materialId)]
  return link ? removeSynthesisNode(workspace, link.nodeId) : workspace
}

export function reconcileSynthesisMaterials(workspace: SynthesisWorkspaceV2, containers: Container[], materials: Material[]) {
  const next = normalizeSynthesisWorkspace(workspace)
  next.sources ??= { containers: {}, materials: {} }
  const sources = next.sources
  const makeHeading = (id: string, title: string, level: number): TiptapJSON => ({
    type: "heading", attrs: { synthesisId: id, level }, content: [{ type: "text", text: title }],
  })
  const eligible = materials.filter((material) => /\.pdf$/i.test(material.file_name))
  for (const container of [...containers].sort((a, b) => a.orderIndex - b.orderIndex)) {
    const files = eligible.filter((material) => material.container_id === container.id
      || (material.container_id == null && material.material_type === container.kind))
      .sort((a, b) => a.order_index - b.order_index || a.id - b.id)
    let link = sources.containers[String(container.id)]
    const newFiles = files.filter((file) => !sources.materials[String(file.id)])
    if (link?.dismissed && !newFiles.length) continue
    const nodes = deriveSynthesisNodes(next.document)
    if (!link || !nodes.some((node) => node.id === link.nodeId)) {
      link = { nodeId: createSynthesisId(), autoTitle: container.name }
      sources.containers[String(container.id)] = link
      if (!nodes.length && !plainText(next.document)) next.document.content = []
      next.document.content!.push(makeHeading(link.nodeId, container.name, 1))
    }
    renameAutomaticHeading(next.document, link, container.name)
    for (const file of files) {
      const existing = sources.materials[String(file.id)]
      if (existing) {
        if (!existing.dismissed) renameAutomaticHeading(next.document, existing, synthesisPdfTitle(file.file_name))
        continue
      }
      const fileLink = { nodeId: createSynthesisId(), autoTitle: synthesisPdfTitle(file.file_name), containerId: container.id }
      sources.materials[String(file.id)] = fileLink
      const blocks = next.document.content!
      const parentIndex = blocks.findIndex((block) => block.attrs?.synthesisId === link.nodeId)
      const parentLevel = Number(blocks[parentIndex]?.attrs?.level) || 1
      let end = parentIndex + 1
      while (end < blocks.length && !(blocks[end].type === "heading" && Number(blocks[end].attrs?.level) <= parentLevel)) end++
      blocks.splice(end, 0, makeHeading(fileLink.nodeId, fileLink.autoTitle, Math.min(3, parentLevel + 1)))
    }
  }
  return normalizeSynthesisWorkspace(next)
}
