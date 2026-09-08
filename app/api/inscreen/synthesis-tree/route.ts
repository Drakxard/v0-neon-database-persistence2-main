import { requireAuthSession } from "@/lib/authz"
import { withInscreenUserConfig } from "@/lib/inscreen-user-config"
import { parseSynthesisContext } from "@/lib/synthesis-context"
import { readSynthesisWorkspace, writeSynthesisWorkspace, SynthesisWorkspaceConflictError } from "@/lib/synthesis-tree-storage"
import { listR2ObjectsByPrefix } from "@/lib/r2"
import { synthesisWeeksFromObjects } from "@/lib/synthesis-weeks"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function handle(request: Request) {
  return withInscreenUserConfig(request, async () => {
    try {
      const auth = await requireAuthSession()
      if (auth.response) return auth.response
      const params = new URL(request.url).searchParams
      const context = parseSynthesisContext(params.get("subjectId"), params.get("weekNumber"))
      if (request.method === "GET" && params.get("listWeeks") === "true") {
        const objects = await listR2ObjectsByPrefix(`manifests/inscreen/sintesis/by-subject/${context.subjectId}/`)
        return Response.json({ weeks: synthesisWeeksFromObjects(context.subjectId, objects) }, { headers: { "Cache-Control": "no-store" } })
      }
      if (request.method === "GET") return Response.json(await readSynthesisWorkspace(context), { headers: { "Cache-Control": "no-store" } })
      const body = await request.json()
      if (!body.workspace || !(body.etag === null || typeof body.etag === "string")) return Response.json({ error: "Síntesis inválida." }, { status: 400 })
      return Response.json(await writeSynthesisWorkspace(context, body.workspace, body.etag))
    } catch (error) {
      if (error instanceof SynthesisWorkspaceConflictError) return Response.json({ error: error.message }, { status: 409 })
      return Response.json({ error: error instanceof Error ? error.message : "No se pudo sincronizar." }, { status: 500 })
    }
  })
}
export const GET = handle
export const PUT = handle
