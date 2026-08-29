import { requireAuthSession } from "@/lib/authz"
import {
  clearInscreenConfigCookie,
  getInscreenConfigSeedFingerprint,
  readLegacyInscreenUserConfig,
  sealInscreenUserConfig,
} from "@/lib/inscreen-user-config"

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response
    const body = await request.json().catch(() => null) as { fileHalf?: string } | null
    const config = readLegacyInscreenUserConfig(request, String(body?.fileHalf || ""))
    return Response.json({ configured: true, token: sealInscreenUserConfig(config), seedFingerprint: getInscreenConfigSeedFingerprint() }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo desbloquear la configuracion."
    if (message === "Falta una mitad de la configuracion InScreen.") {
      return Response.json({ configured: false, error: message }, { headers: { "Cache-Control": "no-store" } })
    }
    return Response.json(
      { error: message, configurationRequired: true },
      { status: 400 }
    )
  }
}

export async function DELETE() {
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store", "Set-Cookie": clearInscreenConfigCookie() } })
}
