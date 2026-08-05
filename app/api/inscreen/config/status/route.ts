import { readInscreenUserConfig } from "@/lib/inscreen-user-config"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    readInscreenUserConfig(request)
    return Response.json({ configured: true }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return Response.json(
      { configured: false, error: error instanceof Error ? error.message : "Configuracion InScreen requerida." },
      { headers: { "Cache-Control": "no-store" } },
    )
  }
}
