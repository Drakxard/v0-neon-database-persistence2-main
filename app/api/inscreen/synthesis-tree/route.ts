import { requireAuthSession } from "@/lib/authz"
import { withInscreenUserConfig } from "@/lib/inscreen-user-config"
import { SynthesisWorkspaceConflictError, readSynthesisWorkspace, writeSynthesisWorkspace } from "@/lib/synthesis-tree-storage"
import { SYNTHESIS_MAX_DOCUMENT_BYTES } from "@/lib/synthesis-workspace"
import { InvalidSynthesisContextError, parseSynthesisContext } from "@/lib/synthesis-context"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  return withInscreenUserConfig(request, async () => {
    try {
      const auth = await requireAuthSession()
      if (auth.response) return auth.response
      const url = new URL(request.url)
      const context = parseSynthesisContext(url.searchParams.get("subjectId"), url.searchParams.get("weekNumber"))
      const snapshot = await readSynthesisWorkspace(context)
      return Response.json({ ok: true, ...snapshot }, { headers: { "Cache-Control": "no-store" } })
    } catch (error) {
      if (error instanceof InvalidSynthesisContextError) {
        return Response.json({ error: error.message }, { status: 400, headers: { "Cache-Control": "no-store" } })
      }
      console.error("GET /api/inscreen/synthesis-tree error:", error)
      return Response.json({ error: error instanceof Error ? error.message : "No se pudo cargar Síntesis." }, { status: 500 })
    }
  })
}

export async function PUT(request: Request) {
  return withInscreenUserConfig(request, async () => {
    try {
      const auth = await requireAuthSession()
      if (auth.response) return auth.response
      if (Number(request.headers.get("content-length") || 0) > SYNTHESIS_MAX_DOCUMENT_BYTES + 20_000) {
        return Response.json({ error: "El árbol de Síntesis es demasiado grande." }, { status: 413 })
      }
      const body = await request.json().catch(() => null) as { subjectId?: unknown; weekNumber?: unknown; workspace?: unknown; etag?: unknown; force?: unknown } | null
      if (!body || body.workspace === undefined) return Response.json({ error: "Falta el documento de Síntesis." }, { status: 400 })
      const context = parseSynthesisContext(body.subjectId, body.weekNumber)
      const result = await writeSynthesisWorkspace(context, body.workspace, typeof body.etag === "string" ? body.etag : null, body.force === true)
      return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } })
    } catch (error) {
      if (error instanceof InvalidSynthesisContextError) {
        return Response.json({ error: error.message }, { status: 400, headers: { "Cache-Control": "no-store" } })
      }
      if (error instanceof SynthesisWorkspaceConflictError) {
        return Response.json({ error: error.message, conflict: true, ...error.snapshot }, { status: 409, headers: { "Cache-Control": "no-store" } })
      }
      console.error("PUT /api/inscreen/synthesis-tree error:", error)
      return Response.json({ error: error instanceof Error ? error.message : "No se pudo guardar Síntesis." }, { status: 400 })
    }
  })
}
