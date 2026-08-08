import { requireAuthSession } from "@/lib/authz"
import { readInscreenUserConfig } from "@/lib/inscreen-user-config"
import { ProviderPairingError, revokeProviderDevice } from "@/lib/inscreen-provider-pairing"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response
    const { id } = await context.params
    await revokeProviderDevice(readInscreenUserConfig(request), id)
    return Response.json({ revoked: true }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    const status = error instanceof ProviderPairingError ? error.status : 400
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo revocar el dispositivo." }, { status, headers: { "Cache-Control": "no-store" } })
  }
}
