import { readInscreenUserConfig } from "@/lib/inscreen-user-config"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const config = readInscreenUserConfig(request)
    return Response.json({ configured: true, services: { groq: Boolean(config.GROQ_API_KEY), r2: Boolean(config.R2_BUCKET_NAME && config.R2_ENDPOINT && config.R2_ACCESS_KEY_ID && config.R2_SECRET_ACCESS_KEY) } }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return Response.json(
      { configured: false, error: error instanceof Error ? error.message : "Configuracion InScreen requerida." },
      { headers: { "Cache-Control": "no-store" } },
    )
  }
}
