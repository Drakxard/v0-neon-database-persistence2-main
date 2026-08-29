import { getInscreenConfigSeedFingerprint, readInscreenUserConfig } from "@/lib/inscreen-user-config"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const config = readInscreenUserConfig(request)
    return Response.json({ configured: true, seedFingerprint: getInscreenConfigSeedFingerprint(), services: { groq: Boolean(config.GROQ_API_KEY), r2: Boolean(config.R2_BUCKET_NAME && config.R2_ENDPOINT && config.R2_ACCESS_KEY_ID && config.R2_SECRET_ACCESS_KEY) } }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    let seedFingerprint = ""
    try { seedFingerprint = getInscreenConfigSeedFingerprint() } catch {}
    return Response.json(
      { configured: false, code: seedFingerprint ? "seed_mismatch_or_corrupt" : "seed_missing", seedFingerprint, error: error instanceof Error ? error.message : "Configuracion InScreen requerida." },
      { headers: { "Cache-Control": "no-store" } },
    )
  }
}
