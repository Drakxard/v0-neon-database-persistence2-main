export const AZURE_WORKSPACE_DIRECTORIES = ["cronograma", "teoria", "practica", "audio", "manifests"] as const
export const AZURE_SYNC_FILE = "azure-sync.json"
export const AZURE_UPLOAD_CHUNK_SIZE = 3 * 1024 * 1024

export function azureWorkspaceId(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) throw new Error("Código de sincronización inválido.")
  return value.toLowerCase()
}

export function azureWorkspacePath(value: unknown) {
  if (typeof value !== "string" || value.length > 1000 || /[\\\x00-\x1f]/.test(value)) throw new Error("Ruta de archivo inválida.")
  const parts = value.split("/")
  if (parts.length < 2 || !AZURE_WORKSPACE_DIRECTORIES.includes(parts[0] as typeof AZURE_WORKSPACE_DIRECTORIES[number])
    || parts.some(part => !part || part === "." || part === ".." || /^User\./i.test(part))
    || value === `manifests/${AZURE_SYNC_FILE}` || value === "manifests/drive-sync.json") throw new Error("Ese archivo no forma parte del respaldo de Azure.")
  return value
}

export function azureContentHash(value: unknown) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) throw new Error("Huella de archivo inválida.")
  return value
}

export function azureBlockId(sessionId: string, index: number) {
  azureWorkspaceId(sessionId)
  if (!Number.isInteger(index) || index < 0 || index >= 50_000) throw new Error("Bloque inválido.")
  return btoa(`${sessionId}:${String(index).padStart(6, "0")}`)
}
