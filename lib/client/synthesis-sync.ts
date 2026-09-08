import { buildSynthesisLocalStorageKey, type SynthesisContext } from "../synthesis-context.ts"
import { SYNTHESIS_WORKSPACE_STORAGE_KEY, referencedLocalImageIds } from "../synthesis-workspace.ts"
import { loadSynthesisImage } from "./synthesis-images.ts"

export const SYNTHESIS_SYNC_EVENT = "synthesis-sync-status"
const running = new Map<string, Promise<void>>()

export function syncSynthesis(context: SynthesisContext): Promise<void> {
  const key = buildSynthesisLocalStorageKey(SYNTHESIS_WORKSPACE_STORAGE_KEY, context)
  const existing = running.get(key)
  if (existing) return existing
  const target = window
  const task = synchronize(context, key).catch((error) => {
    target.dispatchEvent(new CustomEvent(SYNTHESIS_SYNC_EVENT, { detail: { key, error: error instanceof Error ? error.message : "Sin conexión con R2." } }))
  }).finally(() => running.delete(key))
  running.set(key, task)
  return task
}

async function synchronize(context: SynthesisContext, key: string) {
  const url = "/api/inscreen/synthesis-tree?" + new URLSearchParams({ subjectId: context.subjectId, weekNumber: String(context.weekNumber) })
  const request = async (init?: RequestInit) => {
    const response = await fetch(url, { cache: "no-store", ...init })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || "No se pudo sincronizar con R2.")
    return body
  }
  const remote = await request()
  let raw = localStorage.getItem(key)
  const baseline = localStorage.getItem(key + ":r2-content")
  let etag = localStorage.getItem(key + ":r2-etag")
  if (!raw || raw === baseline) {
    if (remote.workspace) {
      raw = JSON.stringify(remote.workspace)
      localStorage.setItem(key, raw!)
      localStorage.setItem(key + ":r2-content", raw!)
      localStorage.setItem(key + ":r2-etag", remote.etag ?? "")
      window.dispatchEvent(new StorageEvent("storage", { key }))
    }
  } else {
    if (remote.etag !== (etag || null)) throw new Error("Hay otra versión en R2. Tus cambios locales se conservaron; no se sobrescribió la versión remota.")
    while (raw) {
      const workspace = JSON.parse(raw)
      for (const id of referencedLocalImageIds(workspace.document)) {
        const file = await loadSynthesisImage(id)
        if (!file) throw new Error("No se encontró una imagen para subir a R2.")
        const response = await fetch("/api/inscreen/synthesis-images?id=" + encodeURIComponent(id), { method: "PUT", body: file })
        if (!response.ok) throw new Error("No se pudo subir una imagen a R2.")
      }
      const saved = await request({ method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace, etag: etag || null }) })
      etag = saved.etag
      localStorage.setItem(key + ":r2-etag", etag ?? "")
      localStorage.setItem(key + ":r2-content", raw)
      const latest = localStorage.getItem(key)
      if (latest === raw) break
      raw = latest
    }
  }
  window.dispatchEvent(new CustomEvent(SYNTHESIS_SYNC_EVENT, { detail: { key } }))
}
