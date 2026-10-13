import { createHash } from "node:crypto"
import { BlobServiceClient, type ContainerClient } from "@azure/storage-blob"
import { azureWorkspaceId, azureWorkspacePath } from "../azure-workspace.ts"

export function azureConnectionString() { return (process.env.storage_azure || process.env.AZURE_STORAGE_CONNECTION_STRING || "").trim() }

export function azureStorage() {
  const connection = azureConnectionString()
  if (!connection) throw new Error("Falta configurar storage_azure en el despliegue.")
  const name = (process.env.storage_azure_container || process.env.AZURE_STORAGE_CONTAINER || "cursado2026").trim()
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(name) || name.includes("--")) throw new Error("El nombre del contenedor de Azure no es válido.")
  const service = BlobServiceClient.fromConnectionString(connection)
  return { service, container: service.getContainerClient(name) }
}

export function azureWorkspacePrefix(email: string, workspaceId: unknown) {
  const owner = createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 32)
  return `workspaces/${owner}/${azureWorkspaceId(workspaceId)}/`
}

export function azureWorkspaceBlob(container: ContainerClient, email: string, workspaceId: unknown, path: unknown) {
  return container.getBlockBlobClient(azureWorkspacePrefix(email, workspaceId) + azureWorkspacePath(path))
}

export function azureStorageFailure(error: unknown) {
  const status = (error as { statusCode?: number })?.statusCode
  return status === 403 || status === 401 ? "Azure rechazó la conexión. Revisá storage_azure y los permisos de la cuenta."
    : status === 409 || status === 412 ? "El archivo cambió en Azure desde la última sincronización. Se conservó la copia remota."
    : status === 404 ? "No se encontró el archivo en Azure."
    : "No se pudo completar la operación con Azure. Revisá la conexión y volvé a intentar."
}
