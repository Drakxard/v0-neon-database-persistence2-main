import { buildSynthesisLocalStorageKey, type SynthesisContext } from "../synthesis-context.ts"
import { SYNTHESIS_WORKSPACE_STORAGE_KEY, assertValidSynthesisWorkspace, referencedLocalImageIds } from "../synthesis-workspace.ts"
import { loadSynthesisImage } from "./synthesis-images.ts"
import { getSynthesisFolderStore } from "./synthesis-persistence.ts"
import { synthesisContent, type SynthesisFolderStore } from "./synthesis-folder-store.ts"

export const SYNTHESIS_SYNC_EVENT = "synthesis-sync-status"
const running = new Map<string, Promise<boolean>>()

export function syncSynthesis(context: SynthesisContext): Promise<boolean> {
  const key = buildSynthesisLocalStorageKey(SYNTHESIS_WORKSPACE_STORAGE_KEY, context)
  const existing = running.get(key)
  if (existing) return existing
  const task = (async () => {
    try {
      const folder = await getSynthesisFolderStore()
      await synchronizeSynthesisFolder(context, folder, fetch, loadSynthesisImage)
      window.dispatchEvent(new CustomEvent(SYNTHESIS_SYNC_EVENT, { detail: { key } }))
      return true
    } catch (error) {
      window.dispatchEvent(new CustomEvent(SYNTHESIS_SYNC_EVENT, { detail: { key, error: error instanceof Error ? error.message : "Sin conexión con R2." } }))
      return false
    }
  })().finally(() => running.delete(key))
  running.set(key, task)
  return task
}

/** The folder is authoritative; neither upload nor download depends on browser caches. */
export async function synchronizeSynthesisFolder(
  context: SynthesisContext,
  folder: SynthesisFolderStore,
  fetcher: typeof fetch,
  readImage: (id: string) => Promise<Blob | null>,
) {
  const url = "/api/inscreen/synthesis-tree?" + new URLSearchParams({ subjectId: context.subjectId, weekNumber: String(context.weekNumber) })
  const request = async (init?: RequestInit) => {
    const response = await fetcher(url, { cache: "no-store", ...init })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || "No se pudo sincronizar con R2.")
    if (!(body.etag === null || typeof body.etag === "string")) throw new Error("Respuesta de R2 inválida.")
    if (body.workspace !== null) assertValidSynthesisWorkspace(body.workspace)
    return body
  }
  const remote = await request()
  let remoteEtag = remote.etag as string | null
  while (true) {
    const local = await folder.read(context)
    const raw = synthesisContent(local?.workspace ?? null)
    const clean = !local || raw === synthesisContent(local.r2.baseline)
    if (clean && remote.workspace) {
      if (await folder.acceptRemote(context, remote.workspace, remoteEtag, raw)) {
        for (const id of referencedLocalImageIds(remote.workspace.document)) {
          if (!await readImage(id)) throw new Error("No se pudo guardar una imagen remota en la carpeta local.")
        }
        return
      }
      continue
    }
    if (!local) return
    if (remote.workspace && remoteEtag !== local.r2.etag) {
      throw new Error("Hay otra versión en R2. Se conservó el documento de la carpeta local; no se sobrescribió la versión remota.")
    }
    for (const id of referencedLocalImageIds(local.workspace.document)) {
      const file = await readImage(id)
      if (!file) throw new Error("No se encontró una imagen de Síntesis en la carpeta local.")
      const response = await fetcher("/api/inscreen/synthesis-images?id=" + encodeURIComponent(id), { method: "PUT", body: file })
      if (!response.ok) throw new Error("No se pudo subir una imagen a R2.")
    }
    const saved = await request({ method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspace: local.workspace, etag: remoteEtag }) })
    remoteEtag = saved.etag
    remote.workspace = saved.workspace
    await folder.acknowledgeUpload(context, local.workspace, remoteEtag)
    const latest = await folder.read(context)
    if (synthesisContent(latest?.workspace ?? null) === raw) return
  }
}
