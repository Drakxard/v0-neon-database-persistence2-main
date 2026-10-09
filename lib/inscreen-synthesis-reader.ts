import type { SynthesisWorkspaceV2, TiptapJSON } from "./synthesis-workspace.ts"

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
  return { ...workspace, document: project(workspace.document) }
}
