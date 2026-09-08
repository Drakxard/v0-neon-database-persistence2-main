import { authorizeProviderToken, bearerToken, ProviderPairingError } from "@/lib/inscreen-provider-pairing"
import { InvalidSynthesisContextError, parseSynthesisContext } from "@/lib/synthesis-context"
import { readSynthesisWorkspace } from "@/lib/synthesis-tree-storage"
import { synthesisWeeksFromObjects } from "@/lib/synthesis-weeks"
import { listR2ObjectsByPrefix } from "@/lib/r2"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
const response = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } })

export async function GET(request: Request) {
  try {
    const token = bearerToken(request)
    if (!token) return response({ ok: false, error: "unauthorized" }, 401)
    return await authorizeProviderToken(token, async () => {
      const params = new URL(request.url).searchParams
      const context = parseSynthesisContext(params.get("subjectId"), params.get("weekNumber") ?? 0)
      if (params.has("weekNumber")) {
        const snapshot = await readSynthesisWorkspace(context)
        if (!snapshot.workspace) return response({ ok: false, error: "synthesis_unavailable" }, 404)
        return response({ ok: true, ...snapshot })
      }
      const objects = await listR2ObjectsByPrefix("manifests/inscreen/sintesis/by-subject/" + context.subjectId + "/")
      return response({ ok: true, weeks: synthesisWeeksFromObjects(context.subjectId, objects) })
    })
  } catch (error) {
    if (error instanceof InvalidSynthesisContextError) return response({ ok: false, error: "invalid_subject_or_week" }, 400)
    if (error instanceof ProviderPairingError) return response({ ok: false, error: error.status === 401 ? "unauthorized" : "provider_rejected" }, error.status)
    console.error("GET provider synthesis error:", error)
    return response({ ok: false, error: "provider_error" }, 500)
  }
}
