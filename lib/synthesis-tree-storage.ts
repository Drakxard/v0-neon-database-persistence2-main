import { downloadR2Object, getR2ObjectMetadata, isR2PreconditionFailedError, uploadR2Object } from "@/lib/r2"
import { RemoteFileNotFoundError } from "@/lib/remote-file-errors"
import { assertValidSynthesisTree, type SynthesisTree } from "@/lib/synthesis-tree"
import { buildSynthesisTreeObjectKey, buildSynthesisWorkspaceObjectKey, parseSynthesisContext, type SynthesisContext } from "@/lib/synthesis-context"
import { assertValidSynthesisWorkspace, type SynthesisWorkspaceV2 } from "@/lib/synthesis-workspace"

export const SYNTHESIS_TREE_OBJECT_KEY = "manifests/inscreen/sintesis/tree-v1.json"

export type SynthesisTreeSnapshot = { tree: SynthesisTree | null; etag: string | null }

export async function readSynthesisTree(context: SynthesisContext): Promise<SynthesisTreeSnapshot> {
  const normalizedContext = parseSynthesisContext(context.subjectId, context.weekNumber)
  const objectKey = buildSynthesisTreeObjectKey(normalizedContext)
  try {
    const object = await downloadR2Object(objectKey)
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

export async function writeSynthesisTree(context: SynthesisContext, input: unknown, expectedEtag: string | null, force = false) {
  const normalizedContext = parseSynthesisContext(context.subjectId, context.weekNumber)
  const objectKey = buildSynthesisTreeObjectKey(normalizedContext)
  const candidate = assertValidSynthesisTree(input)
  const current = await readSynthesisTree(normalizedContext)
  if (!force && current.etag !== expectedEtag) throw new SynthesisTreeConflictError(current)
  const tree: SynthesisTree = {
    ...candidate,
    revision: (current.tree?.revision ?? 0) + 1,
    updatedAt: new Date().toISOString(),
  }
  try {
    await uploadR2Object({
      objectKey,
      mimeType: "application/json; charset=utf-8",
      body: JSON.stringify(tree),
      metadata: {
        "schema-version": String(tree.version),
        revision: String(tree.revision),
        "subject-id": normalizedContext.subjectId,
        "week-number": String(normalizedContext.weekNumber),
      },
      ...(force ? {} : current.etag ? { ifMatch: current.etag } : { ifNoneMatch: "*" }),
    })
  } catch (error) {
    if (isR2PreconditionFailedError(error)) throw new SynthesisTreeConflictError(await readSynthesisTree(normalizedContext))
    throw error
  }
  const metadata = await getR2ObjectMetadata(objectKey)
  return { tree, etag: metadata.etag }
}

export type SynthesisWorkspaceSnapshot = { workspace: SynthesisWorkspaceV2 | null; etag: string | null }

export async function readSynthesisWorkspace(context: SynthesisContext): Promise<SynthesisWorkspaceSnapshot> {
  const normalizedContext = parseSynthesisContext(context.subjectId, context.weekNumber)
  const objectKey = buildSynthesisWorkspaceObjectKey(normalizedContext)
  try {
    const object = await downloadR2Object(objectKey)
    return { workspace: assertValidSynthesisWorkspace(JSON.parse(object.buffer.toString("utf8"))), etag: object.etag }
  } catch (error) {
    if (error instanceof RemoteFileNotFoundError) return { workspace: null, etag: null }
    throw error
  }
}

export class SynthesisWorkspaceConflictError extends Error {
  constructor(public readonly snapshot: SynthesisWorkspaceSnapshot) {
    super("La Síntesis cambió en otro dispositivo.")
  }
}

export async function writeSynthesisWorkspace(context: SynthesisContext, input: unknown, expectedEtag: string | null, force = false) {
  const normalizedContext = parseSynthesisContext(context.subjectId, context.weekNumber)
  const objectKey = buildSynthesisWorkspaceObjectKey(normalizedContext)
  const candidate = assertValidSynthesisWorkspace(input)
  const current = await readSynthesisWorkspace(normalizedContext)
  if (!force && current.etag !== expectedEtag) throw new SynthesisWorkspaceConflictError(current)
  const workspace: SynthesisWorkspaceV2 = {
    ...candidate,
    revision: (current.workspace?.revision ?? 0) + 1,
    updatedAt: new Date().toISOString(),
  }
  try {
    await uploadR2Object({
      objectKey,
      mimeType: "application/json; charset=utf-8",
      body: JSON.stringify(workspace),
      metadata: {
        "schema-version": String(workspace.version),
        revision: String(workspace.revision),
        "subject-id": normalizedContext.subjectId,
        "week-number": String(normalizedContext.weekNumber),
      },
      ...(force ? {} : current.etag ? { ifMatch: current.etag } : { ifNoneMatch: "*" }),
    })
  } catch (error) {
    if (isR2PreconditionFailedError(error)) throw new SynthesisWorkspaceConflictError(await readSynthesisWorkspace(normalizedContext))
    throw error
  }
  const metadata = await getR2ObjectMetadata(objectKey)
  return { workspace, etag: metadata.etag }
}
