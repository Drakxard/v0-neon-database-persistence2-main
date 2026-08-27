import { requireAuthSession } from "@/lib/authz"
import { publishInscreenWidgetTargets, type InscreenWidgetTargetPatch } from "@/lib/inscreen-widget-targets"
import { withInscreenUserConfig } from "@/lib/inscreen-user-config"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  return withInscreenUserConfig(request, async () => {
    try {
      const auth = await requireAuthSession()
      if (auth.response) return auth.response
      if (Number(request.headers.get("content-length") || 0) > 100_000) return Response.json({ error: "Publicacion demasiado grande." }, { status: 413 })
      const body = await request.json().catch(() => null) as { subjects?: unknown; target?: InscreenWidgetTargetPatch | null } | null
      if (!body || (body.subjects === undefined && body.target === undefined)) return Response.json({ error: "Publicacion vacia." }, { status: 400 })
      const manifest = await publishInscreenWidgetTargets({ subjects: body.subjects, target: body.target })
      return Response.json({ ok: true, revision: manifest.revision, updatedAt: manifest.updatedAt }, { headers: { "Cache-Control": "no-store" } })
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "No se pudo publicar." }, { status: 400, headers: { "Cache-Control": "no-store" } })
    }
  })
}
