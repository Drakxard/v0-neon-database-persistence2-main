import { requireAuthSession } from "@/lib/authz"
import {
  openInscreenUserConfigParts,
} from "@/lib/inscreen-user-config"

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response
    const body = await request.json().catch(() => null) as { fileHalf?: string } | null
    openInscreenUserConfigParts(String(body?.fileHalf || ""), request)
    return Response.json({ configured: true }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "No se pudo desbloquear la configuracion.", configurationRequired: true },
      { status: 400 }
    )
  }
}
