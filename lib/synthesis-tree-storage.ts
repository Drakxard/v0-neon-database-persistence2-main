import { downloadR2Object, getR2ObjectMetadata, isR2PreconditionFailedError, uploadR2Object } from "@/lib/r2"
import { RemoteFileNotFoundError } from "@/lib/remote-file-errors"
import { assertValidSynthesisTree, type SynthesisTree } from "@/lib/synthesis-tree"

export const SYNTHESIS_TREE_OBJECT_KEY = "manifests/inscreen/sintesis/tree-v1.json"

export type SynthesisTreeSnapshot = { tree: SynthesisTree | null; etag: string | null }

export async function readSynthesisTree(): Promise<SynthesisTreeSnapshot> {
  try {
    const object = await downloadR2Object(SYNTHESIS_TREE_OBJECT_KEY)
    return { tree: assertValidSynthesisTree(JSON.parse(object.buffer.toString("utf8"))), etag: object.etag }
  } catch (error) {
    if (error instanceof RemoteFileNotFoundError) return { tree: null, etag: null }
    throw error
  }
}

export class SynthesisTreeConflictError extends Error {
  constructor(public readonly snapshot: SynthesisTreeSnapshot) {
    super("La Síntesis cambió en otro dispositivo.")
  }
}

export async function writeSynthesisTree(input: unknown, expectedEtag: string | null, force = false) {
  const candidate = assertValidSynthesisTree(input)
  const current = await readSynthesisTree()
  if (!force && current.etag !== expectedEtag) throw new SynthesisTreeConflictError(current)
  const tree: SynthesisTree = {
    ...candidate,
    revision: (current.tree?.revision ?? 0) + 1,
    updatedAt: new Date().toISOString(),
  }
  try {
    await uploadR2Object({
      objectKey: SYNTHESIS_TREE_OBJECT_KEY,
      mimeType: "application/json; charset=utf-8",
      body: JSON.stringify(tree),
      metadata: { "schema-version": String(tree.version), revision: String(tree.revision) },
      ...(force ? {} : current.etag ? { ifMatch: current.etag } : { ifNoneMatch: "*" }),
    })
  } catch (error) {
    if (isR2PreconditionFailedError(error)) throw new SynthesisTreeConflictError(await readSynthesisTree())
    throw error
  }
  const metadata = await getR2ObjectMetadata(SYNTHESIS_TREE_OBJECT_KEY)
  return { tree, etag: metadata.etag }
}

