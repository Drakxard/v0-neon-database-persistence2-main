import { requireAuthSession } from "@/lib/authz"
import { readInscreenUserConfig } from "@/lib/inscreen-user-config"
import { createProviderPairing } from "@/lib/inscreen-provider-pairing"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response
    const config = readInscreenUserConfig(request)
    const origin = new URL(request.url).origin
    return Response.json(await createProviderPairing(config, origin), { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo crear el QR." }, { status: 400, headers: { "Cache-Control": "no-store" } })
  }
}
