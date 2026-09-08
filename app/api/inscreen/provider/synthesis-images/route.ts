import { authorizeProviderToken, bearerToken, ProviderPairingError } from "@/lib/inscreen-provider-pairing"
import { downloadR2Object } from "@/lib/r2"
import { RemoteFileNotFoundError } from "@/lib/remote-file-errors"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const token = bearerToken(request)
    if (!token) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 })
    return await authorizeProviderToken(token, async () => {
      const id = new URL(request.url).searchParams.get("id") ?? ""
      if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) return Response.json({ ok: false, error: "invalid_image" }, { status: 400 })
      const object = await downloadR2Object("manifests/inscreen/sintesis/images/" + id)
      return new Response(new Uint8Array(object.buffer), { headers: { "Content-Type": object.mimeType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } })
    })
  } catch (error) {
    const status = error instanceof ProviderPairingError ? error.status : error instanceof RemoteFileNotFoundError ? 404 : 500
    return Response.json({ ok: false, error: status === 401 ? "unauthorized" : "image_unavailable" }, { status })
  }
}
