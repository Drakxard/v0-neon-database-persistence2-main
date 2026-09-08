import { type SynthesisWorkspaceV2, plainText } from "../synthesis-workspace.ts"

export const SYNTHESIS_RECOVERY_PREFIX = "inscreen:synthesis:recovery:"

/** Read historical envelopes without normalizing an unknown shape into an empty document. */
export function parseStoredSynthesisWorkspace(raw: string): { workspace: SynthesisWorkspaceV2; etag: string | null } {
  const parsed = JSON.parse(raw)
  const workspace = parsed?.workspace ?? parsed
  if (workspace?.version !== 2 || workspace.document?.type !== "doc" || !Array.isArray(workspace.document.content)) {
    throw new Error("El guardado de Síntesis tiene un formato anterior o inválido. Buscá la copia en Guardados locales.")
  }
  return { workspace, etag: typeof parsed?.etag === "string" ? parsed.etag : null }
}

export function preserveSynthesisCopy(storage: Pick<Storage, "getItem" | "setItem">, sourceKey: string, raw: string) {
  // One immutable copy per value; repeated syncs must not fill the browser's storage.
  const lastKey = `${sourceKey}:recovery-last`
  if (storage.getItem(lastKey) === raw) return
  const key = `${SYNTHESIS_RECOVERY_PREFIX}${globalThis.crypto.randomUUID()}`
  storage.setItem(key, JSON.stringify({ sourceKey, raw, savedAt: new Date().toISOString() }))
  storage.setItem(lastKey, raw)
}

export type SynthesisLocalCopy = {
  key: string
  sourceKey: string
  raw: string
  subjectId: string | null
  weekNumber: number | null
  preview: string
  version: number | null
}

/** Include all subjects, weeks, pending writes, old trees and sync baselines. Never writes. */
export function findSynthesisLocalCopies(storage: Pick<Storage, "length" | "key" | "getItem">): SynthesisLocalCopy[] {
  const copies: SynthesisLocalCopy[] = []
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index)
    if (!key || !/^(?:inscreen:synthesis:(?:workspace-v2|pending-v2|recovery:)|inscreen\.sintesis\.(?:tree|pending)\.v1)/.test(key)) continue
    if (/:r2-etag$|:recovery-last$/.test(key)) continue
    const raw = storage.getItem(key)
    if (!raw) continue
    let sourceKey = key
    let content = raw
    try {
      if (key.startsWith(SYNTHESIS_RECOVERY_PREFIX)) {
        const backup = JSON.parse(raw)
        sourceKey = backup.sourceKey
        content = backup.raw
      }
      const parsed = JSON.parse(content)
      const value = parsed.workspace ?? parsed.tree ?? parsed
      if (!value || typeof value !== "object" || (!value.document && !value.nodes)) continue
      const scope = /:([^:]+):week-(\d+)(?::|$)/.exec(sourceKey) ?? /manifests\/sintesis\/([^/]+)\/semana-(\d+)\//.exec(sourceKey)
      const preview = value.document ? plainText(value.document) : Object.values(value.nodes ?? {})
        .map((node) => { const item = node as { name?: string; content?: string }; return `${item.name ?? ""} ${item.content ?? ""}` }).join(" · ")
      copies.push({ key, sourceKey, raw: content, subjectId: scope ? decodeURIComponent(scope[1]) : null,
        weekNumber: scope ? Number(scope[2]) : null, preview: preview.slice(0, 240), version: value.version ?? null })
    } catch { copies.push({ key, sourceKey, raw: content, subjectId: null, weekNumber: null, preview: "No se pudo interpretar esta copia; podés descargarla para revisarla.", version: null }) }
  }
  return copies.sort((a, b) => Number(Boolean(b.preview)) - Number(Boolean(a.preview)))
}
