import { ProviderPairingError, redeemProviderPairing } from "@/lib/inscreen-provider-pairing"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  try {
    if (Number(request.headers.get("content-length") || 0) > 20_000) throw new ProviderPairingError(413, "Solicitud demasiado grande.")
    const body = await request.json().catch(() => null) as { token?: unknown; installationId?: unknown } | null
    const token = typeof body?.token === "string" ? body.token : ""
    const installationId = typeof body?.installationId === "string" ? body.installationId.trim() : ""
    const origin = new URL(request.url).origin
    return Response.json(await redeemProviderPairing(token, installationId, origin), { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    const status = error instanceof ProviderPairingError ? error.status : 400
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo vincular el dispositivo." }, { status, headers: { "Cache-Control": "no-store" } })
  }
}
