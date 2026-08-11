import { convertFileWithDatalabMarker, DatalabMarkerError } from "@/lib/datalab-marker"
import { getInscreenRuntimeSecret } from "@/lib/inscreen-user-config"
import { authorizeProviderToken, bearerToken, ProviderPairingError } from "@/lib/inscreen-provider-pairing"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const MAX_REQUEST_BYTES = 4_400_000
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])

function json(body: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0", ...headers },
  })
}

export async function POST(request: Request) {
  try {
    const token = bearerToken(request)
    if (!token) return json({ ok: false, error: "unauthorized" }, 401, { "WWW-Authenticate": "Bearer" })
    const declaredLength = Number(request.headers.get("content-length") || 0)
    if (declaredLength > MAX_REQUEST_BYTES) return json({ ok: false, error: "image_too_large" }, 413)

    return await authorizeProviderToken(token, async () => {
      if (!getInscreenRuntimeSecret("MARKER_API")) {
        return json({ ok: false, error: "provider_repair_required" }, 428)
      }
      const formData = await request.formData()
      const file = formData.get("file")
      if (!(file instanceof File) || !ALLOWED_IMAGE_TYPES.has(file.type)) {
        return json({ ok: false, error: "invalid_image" }, 400)
      }
      if (!file.size || file.size > MAX_IMAGE_BYTES) {
        return json({ ok: false, error: "image_too_large" }, 413)
      }
      const markdown = await convertFileWithDatalabMarker({ file, maxPollAttempts: 240 })
      return json({ ok: true, markdown })
    })
  } catch (error) {
    if (error instanceof ProviderPairingError) return json({ ok: false, error: error.message }, error.status)
    if (error instanceof DatalabMarkerError) {
      console.error("POST InScreen provider marker-transcribe error:", error)
      return json({ ok: false, error: "marker_failed" }, 502)
    }
    console.error("POST InScreen provider marker-transcribe error:", error)
    return json({ ok: false, error: "provider_internal_error" }, 500)
  }
}
