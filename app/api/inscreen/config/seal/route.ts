import { requireAuthSession } from "@/lib/authz"
import { randomUUID } from "node:crypto"
import { deleteR2Object, downloadR2Object, uploadR2Object } from "@/lib/r2"
import { listGroqGenerationModels } from "@/lib/groq-models"
import { getInscreenConfigSeedFingerprint, normalizeInscreenUserConfig, readInscreenUserConfig, sealInscreenUserConfig, withInscreenRuntimeConfig } from "@/lib/inscreen-user-config"

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response
    const body = await request.json().catch(() => null)
    let previous: Record<string, string> = {}
    try { previous = readInscreenUserConfig(request) } catch {}
    const updates = body && typeof body === "object" ? Object.fromEntries(Object.entries(body).filter(([, value]) => String(value || "").trim())) : {}
    const config = normalizeInscreenUserConfig({ ...previous, ...updates })
    if ("GROQ_API_KEY" in updates) await withInscreenRuntimeConfig(config, () => listGroqGenerationModels())
    if (["R2_BUCKET_NAME", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_ENDPOINT"].some((field) => field in updates)) {
      const objectKey = `manifests/inscreen/health/${randomUUID()}.txt`
      await withInscreenRuntimeConfig(config, async () => {
        try {
          await uploadR2Object({ objectKey, mimeType: "text/plain", body: "User.Services R2 verification" })
          const downloaded = await downloadR2Object(objectKey)
          if (downloaded.buffer.toString("utf8") !== "User.Services R2 verification") throw new Error("R2 no devolvio el contenido de verificacion.")
        } finally {
          await deleteR2Object(objectKey).catch(() => undefined)
        }
      })
    }
    return Response.json({
      token: sealInscreenUserConfig(config),
      seedFingerprint: getInscreenConfigSeedFingerprint(),
      validatedAt: new Date().toISOString(),
      services: {
        groq: Boolean(config.GROQ_API_KEY),
        r2: Boolean(config.R2_BUCKET_NAME && config.R2_ENDPOINT && config.R2_ACCESS_KEY_ID && config.R2_SECRET_ACCESS_KEY),
      },
    }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo cifrar la configuracion." }, { status: 400 })
  }
}
