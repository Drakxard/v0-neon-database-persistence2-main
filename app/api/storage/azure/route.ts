import { createHash } from "node:crypto"
import { requireAuthSession } from "@/lib/authz"
import { azureConnectionString, azureStorage, azureStorageFailure, azureWorkspaceBlob } from "@/lib/server/azure-storage"
import { azureContentHash, azureWorkspaceId, azureWorkspacePath, AZURE_UPLOAD_CHUNK_SIZE } from "@/lib/azure-workspace"

export const runtime = "nodejs"
export const maxDuration = 300

export async function GET() {
  const auth = await requireAuthSession()
  if (auth.response) return auth.response
  if (!azureConnectionString()) return Response.json({ configured: false })
  try {
    const { service, container } = azureStorage()
    await service.getAccountInfo()
    return Response.json({ configured: true, connected: true, account: service.accountName, container: container.containerName,
      target: createHash("sha256").update(`${service.url.split("?")[0]}:${container.containerName}:${auth.session.email}`).digest("hex") }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return Response.json({ configured: true, connected: false, error: azureStorageFailure(error) }, { headers: { "Cache-Control": "no-store" } })
  }
}

export async function POST(request: Request) {
  const auth = await requireAuthSession()
  if (auth.response) return auth.response
  let body: { workspaceId: string; path: string; hash: string; expectedEtag?: string; action: "prepare" | "commit"; blocks?: string[]; contentType?: string }
  try {
    body = await request.json()
    azureWorkspaceId(body.workspaceId); azureWorkspacePath(body.path); azureContentHash(body.hash)
    if (!["prepare", "commit"].includes(body.action) || (body.expectedEtag !== undefined && (typeof body.expectedEtag !== "string" || body.expectedEtag.length > 200))) throw new Error()
    if (body.action === "commit" && (!Array.isArray(body.blocks) || body.blocks.length > 50_000 || body.blocks.some(id => typeof id !== "string" || !/^[A-Za-z0-9+/]{58}==$/.test(id)))) throw new Error()
  } catch { return Response.json({ error: "Solicitud de sincronización inválida." }, { status: 400 }) }
  try {
    const { container } = azureStorage()
    const blob = azureWorkspaceBlob(container, auth.session.email, body.workspaceId, body.path)
    if (body.action === "prepare") {
      await container.createIfNotExists()
      const properties = await blob.getProperties().catch(error => { if (error.statusCode === 404) return null; throw error })
      if (properties?.metadata?.contenthash === body.hash) return Response.json({ synced: true, etag: properties.etag })
      if (properties && properties.etag !== body.expectedEtag) return Response.json({ error: "El archivo cambió en Azure. Se conservaron la copia remota y el archivo local." }, { status: 409 })
      return Response.json({ synced: false, expectedEtag: properties?.etag })
    }
    const type = typeof body.contentType === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(body.contentType) ? body.contentType : "application/octet-stream"
    const result = await blob.commitBlockList(body.blocks!, { metadata: { contenthash: body.hash }, blobHTTPHeaders: { blobContentType: type },
      conditions: body.expectedEtag ? { ifMatch: body.expectedEtag } : { ifNoneMatch: "*" } })
    return Response.json({ synced: true, etag: result.etag })
  } catch (error) { return Response.json({ error: azureStorageFailure(error) }, { status: (error as { statusCode?: number })?.statusCode === 412 ? 409 : 502 }) }
}

export async function PUT(request: Request) {
  const auth = await requireAuthSession()
  if (auth.response) return auth.response
  const query = new URL(request.url).searchParams
  try {
    azureWorkspaceId(query.get("workspaceId")); azureWorkspacePath(query.get("path"))
    if (!/^[A-Za-z0-9+/]{58}==$/.test(query.get("block") || "") || Number(request.headers.get("content-length") || 0) > AZURE_UPLOAD_CHUNK_SIZE) throw new Error()
  } catch { return Response.json({ error: "Bloque de sincronización inválido." }, { status: 400 }) }
  try {
    const bytes = Buffer.from(await request.arrayBuffer())
    if (!bytes.length || bytes.length > AZURE_UPLOAD_CHUNK_SIZE) return Response.json({ error: "El bloque supera el tamaño permitido." }, { status: 413 })
    const { container } = azureStorage()
    await azureWorkspaceBlob(container, auth.session.email, query.get("workspaceId"), query.get("path")).stageBlock(query.get("block")!, bytes, bytes.length)
    return Response.json({ uploaded: true })
  } catch (error) { return Response.json({ error: azureStorageFailure(error) }, { status: 502 }) }
}
