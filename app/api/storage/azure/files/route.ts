import { Readable } from "node:stream"
import { requireAuthSession } from "@/lib/authz"
import { azureStorage, azureStorageFailure, azureWorkspacePrefix, azureWorkspaceBlob } from "@/lib/server/azure-storage"
import { azureWorkspaceId, azureWorkspacePath } from "@/lib/azure-workspace"

export const runtime = "nodejs"
export const maxDuration = 300

export async function GET(request: Request) {
  const auth = await requireAuthSession()
  if (auth.response) return auth.response
  const query = new URL(request.url).searchParams
  try { azureWorkspaceId(query.get("workspaceId")); if (query.has("path")) azureWorkspacePath(query.get("path")) }
  catch { return Response.json({ error: "Código o ruta de sincronización inválidos." }, { status: 400 }) }
  try {
    const { container } = azureStorage()
    if (query.has("path")) {
      const file = await azureWorkspaceBlob(container, auth.session.email, query.get("workspaceId"), query.get("path")).download()
      if (!file.readableStreamBody) throw new Error("Sin archivo")
      return new Response(Readable.toWeb(file.readableStreamBody as Readable) as ReadableStream<Uint8Array>, { headers: {
        "Content-Type": "application/octet-stream", "Content-Disposition": "attachment", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      } })
    }
    const prefix = azureWorkspacePrefix(auth.session.email, query.get("workspaceId"))
    const files = []
    for await (const blob of container.listBlobsFlat({ prefix, includeMetadata: true })) {
      const path = blob.name.slice(prefix.length)
      try { azureWorkspacePath(path) } catch { continue }
      files.push({ path, etag: blob.properties.etag, hash: blob.metadata?.contenthash, size: blob.properties.contentLength })
      if (files.length > 50_000) throw new Error("Demasiados archivos")
    }
    return Response.json({ files }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 404 && !query.has("path")) return Response.json({ files: [] })
    return Response.json({ error: azureStorageFailure(error) }, { status: 502 })
  }
}
