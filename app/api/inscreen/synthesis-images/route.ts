import { requireAuthSession } from "@/lib/authz"
import { withInscreenUserConfig } from "@/lib/inscreen-user-config"
import { downloadR2Object, uploadR2Object } from "@/lib/r2"
import { RemoteFileNotFoundError } from "@/lib/remote-file-errors"
import { SYNTHESIS_MAX_IMAGE_BYTES } from "@/lib/synthesis-workspace"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function handle(request: Request) {
  return withInscreenUserConfig(request, async () => {
    try {
      const auth = await requireAuthSession()
      if (auth.response) return auth.response
      const id = new URL(request.url).searchParams.get("id") ?? ""
      if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) return Response.json({ error: "Imagen inválida." }, { status: 400 })
      const objectKey = "manifests/inscreen/sintesis/images/" + id
      if (request.method === "GET") {
        const object = await downloadR2Object(objectKey)
        return new Response(new Uint8Array(object.buffer), { headers: { "Content-Type": object.mimeType || "application/octet-stream", "Cache-Control": "no-store" } })
      }
      const mimeType = request.headers.get("content-type") ?? ""
      if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mimeType)) return Response.json({ error: "Formato inválido." }, { status: 400 })
      const body = Buffer.from(await request.arrayBuffer())
      if (body.length > SYNTHESIS_MAX_IMAGE_BYTES) return Response.json({ error: "Imagen demasiado grande." }, { status: 413 })
      await uploadR2Object({ objectKey, mimeType, body })
      return Response.json({ ok: true })
    } catch (error) {
      return Response.json({ error: "No se pudo sincronizar la imagen." }, { status: error instanceof RemoteFileNotFoundError ? 404 : 500 })
    }
  })
}
export const GET = handle
export const PUT = handle
