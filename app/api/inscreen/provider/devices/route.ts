import { requireAuthSession } from "@/lib/authz"
import { readInscreenUserConfig } from "@/lib/inscreen-user-config"
import { listProviderDevices } from "@/lib/inscreen-provider-pairing"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response
    return Response.json({ devices: await listProviderDevices(readInscreenUserConfig(request)) }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudieron listar los dispositivos." }, { status: 400, headers: { "Cache-Control": "no-store" } })
  }
}
