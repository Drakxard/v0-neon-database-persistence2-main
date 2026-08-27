import { authorizeProviderToken, bearerToken, ProviderPairingError } from "@/lib/inscreen-provider-pairing"
import { readInscreenWidgetTargets, resolveInscreenWidgetTarget, type InscreenWidgetTargetKind } from "@/lib/inscreen-widget-targets"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store, max-age=0" } })
}

export async function GET(request: Request) {
  try {
    const token = bearerToken(request)
    if (!token) return response({ ok: false, error: "unauthorized" }, 401)
    return await authorizeProviderToken(token, async () => {
      const manifest = (await readInscreenWidgetTargets()).value
      const url = new URL(request.url)
      const subjectId = String(url.searchParams.get("subjectId") || "").trim()
      const kind = String(url.searchParams.get("kind") || "").trim() as InscreenWidgetTargetKind
      if (!subjectId && !kind) {
        return response({
          ok: true,
          revision: manifest.revision,
          subjects: manifest.subjects.map((subject) => ({
            id: subject.id,
            name: subject.name,
            color: subject.color,
            notebooklmAvailable: Boolean(subject.targets.notebooklm),
            materialsAvailable: Boolean(subject.targets.materials),
            materialsWeekNumber: subject.targets.materials?.weekNumber ?? null,
          })),
        })
      }
      if (!/^[a-zA-Z0-9_-]{1,180}$/.test(subjectId) || (kind !== "notebooklm" && kind !== "materials")) {
        return response({ ok: false, error: "invalid_target" }, 400)
      }
      const target = resolveInscreenWidgetTarget(manifest, subjectId, kind)
      if (!target) return response({ ok: false, error: "target_unavailable" }, 404)
      return response({ ok: true, url: target.url, revision: target.revision, sectionKey: target.sectionKey ?? null, weekNumber: target.weekNumber ?? null })
    })
  } catch (error) {
    if (error instanceof ProviderPairingError) return response({ ok: false, error: error.status === 401 ? "unauthorized" : "provider_rejected" }, error.status)
    console.error("GET provider widget-targets error:", error)
    return response({ ok: false, error: "provider_error" }, 500)
  }
}
