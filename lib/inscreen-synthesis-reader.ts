import { deriveSynthesisNodes, type SynthesisWorkspaceV2, type TiptapJSON } from "./synthesis-workspace.ts"

// Plain text survives the native renderer in already installed InScreen APKs.
// This is a transport projection, never the document saved in the editor/R2.
export function synthesisWorkspaceForReader(workspace: SynthesisWorkspaceV2): SynthesisWorkspaceV2 {
  function project(node: TiptapJSON): TiptapJSON {
    if (node.type === "codeBlock") return node
    if (node.type === "synthesisMath" && typeof node.attrs?.latex === "string") {
      const payload = Buffer.from(JSON.stringify({ latex: node.attrs.latex, display: node.attrs.display === true }), "utf8").toString("base64url")
      return { type: "text", text: `[[INSCREEN-MATH-V1:${payload}]]`, ...(node.marks ? { marks: node.marks } : {}) }
    }
    return node.content ? { ...node, content: node.content.map(project) } : node
  }
  const nodes = new Map(deriveSynthesisNodes(workspace.document).map(node => [node.id, node]))
  const content: TiptapJSON[] = []
  for (const block of workspace.document.content ?? []) {
    if (block.type === "heading" && Number(block.attrs?.level) !== 1) {
      // Android splits on every top-level heading. v0 uses H2–H6 as ordinary
      // content, so pass them through its recursive renderer without splitting.
      content.push({ type: "inscreenReaderContent", content: [project(block)] })
      continue
    }
    content.push(project(block))
    if (block.type === "heading") {
      const node = nodes.get(String(block.attrs?.synthesisId))
      if (node) {
        const payload = Buffer.from(JSON.stringify({ id: node.id, parentId: node.parentId }), "utf8").toString("base64url")
        // All native headings remain H1. The downloadable reader restores v0's
        // explicit parent links, including trees deeper than Android's H1–H3.
        // Keep metadata invisible even when Android briefly uses an older cached
        // reader. Its renderer preserves HTTP link attributes and a zero-width
        // label without ever displaying the payload as document text.
        content.push({ type: "paragraph", content: [{ type: "text", text: "\u2060", marks: [{ type: "link", attrs: { href: `https://synthesis.local/#INSCREEN-NODE-V1:${payload}` } }] }] })
      }
    }
  }
  return { ...workspace, document: { ...workspace.document, content } }
}
