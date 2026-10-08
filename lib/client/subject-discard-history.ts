"use client"

import { normalizePdfQuery, type PdfSearchResult } from "../subject-pdf-search"
import { inPdfCacheQueue, pdfWorkspaceRoot, readPdfCache, writePdfCache } from "./subject-pdf-cache"

export type DiscardEntry = {
  id: string; scope: string; kind: "image" | "pdf" | "topic"; itemId: string; undone: boolean;
  result?: PdfSearchResult; legacy?: boolean
}
type History = { version: 1; subjectId: string; entries: DiscardEntry[] }
const pathFor = (subjectId: string) => `manifests/subject-voice/${encodeURIComponent(subjectId).replace(/\./g, "%2E")}/discard-history-v1.json`
export const queryDiscardScope = (query: string) => `query:${normalizePdfQuery(query)}`
export const pdfDiscardId = (result: PdfSearchResult) => JSON.stringify([result.hash, result.query, result.candidate.anchorIds])
async function load(root: FileSystemDirectoryHandle, subjectId: string): Promise<History> {
  return await readPdfCache<History>(root, pathFor(subjectId), { valid: value => value.version === 1 && value.subjectId === subjectId &&
    Array.isArray(value.entries) && value.entries.every(entry => Boolean(entry) && typeof entry.id === "string" && typeof entry.scope === "string" &&
      ["image", "pdf", "topic"].includes(entry.kind) && typeof entry.itemId === "string" && typeof entry.undone === "boolean" &&
      (entry.kind !== "pdf" || Boolean(entry.result && typeof entry.result.query === "string" && typeof entry.result.hash === "string" &&
        Array.isArray(entry.result.candidate?.anchorIds) && Array.isArray(entry.result.candidate?.blocks) &&
        Array.isArray(entry.result.decision?.blockIds) && Array.isArray(entry.result.decision?.partialIds)))) })
    ?? { version: 1, subjectId, entries: [] }
}
export async function loadDiscardHistory(subjectId: string) {
  const root = await pdfWorkspaceRoot()
  return inPdfCacheQueue(root, pathFor(subjectId), async () => (await load(root, subjectId)).entries)
}
async function update(subjectId: string, change: (history: History) => boolean) {
  const root = await pdfWorkspaceRoot(), path = pathFor(subjectId)
  return inPdfCacheQueue(root, path, async () => {
    const history = await load(root, subjectId)
    if (change(history)) await writePdfCache(root, path, history)
    return history.entries
  })
}
export function discardItem(subjectId: string, item: Omit<DiscardEntry, "id" | "undone">) {
  return update(subjectId, history => {
    if (history.entries.some(entry => !entry.undone && entry.scope === item.scope && entry.kind === item.kind && entry.itemId === item.itemId)) return false
    history.entries.push({ ...item, id: crypto.randomUUID(), undone: false }); return true
  })
}
export function undoDiscard(subjectId: string, scopes: string[], entryId?: string) {
  return update(subjectId, history => {
    const entry = history.entries.findLast(entry => !entry.undone && (entryId ? entry.id === entryId : scopes.includes(entry.scope)))
    if (!entry) return false
    entry.undone = true; return true
  })
}
export function isDiscarded(entries: DiscardEntry[], scope: string, kind: DiscardEntry["kind"], itemId: string) {
  return entries.some(entry => !entry.undone && entry.scope === scope && entry.kind === kind && entry.itemId === itemId)
}
// Legacy corrections remain untouched. An undone imported entry overrides only its old hidden flag.
export async function importLegacyPdfDiscard(subjectId: string, result: PdfSearchResult) {
  const itemId = pdfDiscardId(result), scope = queryDiscardScope(result.query)
  const entries = await update(subjectId, history => {
    if (history.entries.some(entry => entry.legacy && entry.itemId === itemId)) return false
    history.entries.push({ id: crypto.randomUUID(), scope, kind: "pdf", itemId, result, legacy: true, undone: false }); return true
  })
  return entries.some(entry => entry.legacy && entry.itemId === itemId && !entry.undone)
}
