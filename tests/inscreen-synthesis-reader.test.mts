import assert from "node:assert/strict"
import test from "node:test"
import { synthesisWorkspaceForReader } from "../lib/inscreen-synthesis-reader.ts"
import { InvalidSynthesisImageError, synthesisImageMimeType } from "../lib/synthesis-image-format.ts"
import { createEmptySynthesisWorkspace, SYNTHESIS_MAX_IMAGE_BYTES } from "../lib/synthesis-workspace.ts"

test("provider projection survives native escaping without changing saved math, marks, images or code", () => {
  const math = { type: "synthesisMath", attrs: { latex: String.raw`\frac{α}{2} < & </script>`, display: true }, marks: [{ type: "bold" }] }
  const workspace = { ...createEmptySynthesisWorkspace(), document: { type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: "Antes " }, math, { type: "text", text: " después" }] },
    { type: "codeBlock", content: [math] },
    { type: "image", attrs: { src: "synthesis-local-image:abc-123" } },
  ] } }
  const saved = JSON.stringify(workspace)
  const projected = synthesisWorkspaceForReader(workspace)
  const text = projected.document.content![0].content![1]
  assert.equal(text.type, "text")
  assert.deepEqual(text.marks, math.marks)
  const escaped = text.text!.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  const payload = escaped.match(/^\[\[INSCREEN-MATH-V1:([A-Za-z0-9_-]+)\]\]$/)![1]
  assert.deepEqual(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")), math.attrs)
  assert.equal(JSON.stringify(workspace), saved)
  assert.deepEqual(projected.document.content![1], workspace.document.content[1])
  assert.deepEqual(projected.document.content![2], workspace.document.content[2])
})

test("image responses identify Android formats even with generic or incorrect R2 metadata", () => {
  const samples: [number[], string][] = [
    [[137,80,78,71,13,10,26,10], "image/png"],
    [[255,216,255,224], "image/jpeg"],
    [[...Buffer.from("GIF89a")], "image/gif"],
    [[...Buffer.from("GIF87a")], "image/gif"],
    [[...Buffer.from("RIFF"), 0,0,0,0, ...Buffer.from("WEBP")], "image/webp"],
  ]
  for (const [bytes, expected] of samples) assert.equal(synthesisImageMimeType(Uint8Array.from(bytes)), expected)
  for (const bytes of [new Uint8Array(), Buffer.from("<svg></svg>"), Buffer.from("{\"error\":\"unauthorized\"}"), new Uint8Array(SYNTHESIS_MAX_IMAGE_BYTES + 1)]) {
    assert.throws(() => synthesisImageMimeType(bytes), InvalidSynthesisImageError)
  }
})

test("provider preserves v0 parent links and keeps formatted headings inside their owning node", () => {
  const heading = (id: string, parentId?: string) => ({ type: "heading", attrs: { level: 1, synthesisId: id, ...(parentId ? { synthesisParentId: parentId } : {}) }, content: [{ type: "text", text: id }] })
  const formatted = { type: "heading", attrs: { level: 2, synthesisId: "subtitle" }, content: [{ type: "text", text: "Subtítulo del texto" }] }
  const paragraph = { type: "paragraph", content: [{ type: "text", text: "Inicio propio del nivel" }] }
  const workspace = { ...createEmptySynthesisWorkspace(), document: { type: "doc", content: [
    heading("root"), paragraph, formatted, paragraph,
    heading("child", "root"), paragraph, heading("grandchild", "child"), paragraph,
    heading("deep", "grandchild"), paragraph, heading("other"), paragraph,
  ] } }
  const saved = JSON.stringify(workspace)
  const projected = synthesisWorkspaceForReader(workspace)
  const blocks = projected.document.content!
  assert.equal(blocks.filter(block => block.type === "heading").length, 5)
  assert.deepEqual(blocks.find(block => block.type === "inscreenReaderContent")?.content, [formatted])
  const links = blocks.filter(block => block.type === "paragraph" && block.content?.[0]?.text?.startsWith("[[INSCREEN-NODE-V1:"))
    .map(block => JSON.parse(Buffer.from(block.content![0].text!.match(/:([^:]+)\]\]$/)![1], "base64url").toString("utf8")))
  assert.deepEqual(links, [
    { id: "root", parentId: null }, { id: "child", parentId: "root" },
    { id: "grandchild", parentId: "child" }, { id: "deep", parentId: "grandchild" }, { id: "other", parentId: null },
  ])
  assert.equal(blocks.filter(block => block.content?.[0]?.text === "Inicio propio del nivel").length, 6)
  assert.equal(JSON.stringify(workspace), saved)
})
