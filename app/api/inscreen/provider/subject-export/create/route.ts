import { requireAuthSession } from "@/lib/authz"
import { createSubjectExport } from "@/lib/inscreen-provider-pairing"
import { readInscreenUserConfig } from "@/lib/inscreen-user-config"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response
    if (Number(request.headers.get("content-length") || 0) > 50_000) {
      return Response.json({ error: "La exportacion es demasiado grande." }, { status: 413 })
    }
    const body = await request.json().catch(() => null) as { tabName?: unknown; subjects?: unknown } | null
    const origin = new URL(request.url).origin
    return Response.json(await createSubjectExport(
      readInscreenUserConfig(request),
      String(body?.tabName || ""),
      body?.subjects,
      origin,
    ), { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    const status = error instanceof Error && "status" in error && typeof error.status === "number" ? error.status : 400
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo crear la exportacion." }, { status, headers: { "Cache-Control": "no-store" } })
  }
}
