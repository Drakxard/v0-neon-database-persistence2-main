import { requireAuthSession } from "@/lib/authz"
import {
  InscreenHttpError,
  inscreenErrorResponse,
  inscreenMetadata,
  parseInscreenMaterialContext,
  resolveInscreenStage,
  updateInscreenMaterialManifest,
  uploadNextInscreenText,
} from "@/lib/inscreen-server"
import { deleteR2Object } from "@/lib/r2"
import { withInscreenUserConfig } from "@/lib/inscreen-user-config"

export const runtime = "nodejs"

type TranslationEntry = { id: string; source: string; translation: string }

function normalizeLine(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim()
}

function parseEntries(value: unknown): TranslationEntry[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500) return []
  const seen = new Set<string>()
  return value.flatMap((item) => {
    const entry = item && typeof item === "object" ? item as Record<string, unknown> : {}
    const id = String(entry.id || "").trim()
    const source = normalizeLine(entry.source)
    const translation = normalizeLine(entry.translation)
    if (!/^[0-9a-f-]{16,}$/i.test(id) || !source || !translation || seen.has(id)) return []
    seen.add(id)
    return [{ id, source, translation }]
  })
}

async function saveTranslationBatch(request: Request) {
  let uploadedObjectKey = ""
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    const context = parseInscreenMaterialContext(body ?? {})
    const batchId = String(body?.batchId || "").trim()
    const entries = parseEntries(body?.entries)
    if (!/^[0-9a-f]{8}-[0-9a-f-]{9,}$/i.test(batchId)) {
      return Response.json({ error: "Invalid translation batch id" }, { status: 400 })
    }
    if (!entries.length) return Response.json({ error: "No hay traducciones para guardar." }, { status: 400 })

    const stage = await resolveInscreenStage(auth.session!, context)
    const reserved = await updateInscreenMaterialManifest(context, (manifest) => {
      const existing = manifest.translationBatches[batchId]
      if (!existing) {
        manifest.translationBatches[batchId] = {
          status: "pending",
          r2Key: null,
          entryCount: entries.length,
          updatedAt: new Date().toISOString(),
        }
      } else if (existing.entryCount !== entries.length) {
        throw new InscreenHttpError(409, "El lote de traducciones no coincide con el reintento.")
      }
      return manifest
    })
    const batch = reserved.translationBatches[batchId]
    if (batch.status === "complete") {
      return Response.json({ status: "duplicate", batchId, r2Key: batch.r2Key })
    }

    const uploaded = await uploadNextInscreenText({
      subjectSegment: context.subjectSegment,
      stageNumber: stage.currentStage,
      kind: "transcripcion",
      body: entries.map((entry) => `${entry.source}:${entry.translation}`).join("\n"),
      metadata: {
        ...inscreenMetadata(context, stage.currentStage),
        "translation-batch-id": batchId,
        "translation-count": String(entries.length),
      },
    })
    uploadedObjectKey = uploaded.objectKey
    const completed = await updateInscreenMaterialManifest(context, (manifest) => {
      const current = manifest.translationBatches[batchId]
      if (!current) throw new InscreenHttpError(409, "La reserva del lote ya no existe.")
      if (current.status === "complete") return manifest
      current.status = "complete"
      current.r2Key = uploaded.objectKey
      current.updatedAt = new Date().toISOString()
      return manifest
    })
    const finalBatch = completed.translationBatches[batchId]
    if (finalBatch.r2Key !== uploaded.objectKey) {
      await deleteR2Object(uploaded.objectKey)
      uploadedObjectKey = ""
      return Response.json({ status: "duplicate", batchId, r2Key: finalBatch.r2Key })
    }
    return Response.json({ status: "complete", batchId, r2Key: uploaded.objectKey })
  } catch (error) {
    if (uploadedObjectKey) await deleteR2Object(uploadedObjectKey).catch(() => undefined)
    console.error("POST /api/inscreen/translation-batches error:", error)
    return inscreenErrorResponse(error)
  }
}

export async function POST(request: Request) {
  return withInscreenUserConfig(request, () => saveTranslationBatch(request))
}
