import { requireAuthSession } from "@/lib/authz"
import { normalizeInscreenPageText } from "@/lib/inscreen"
import {
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

async function savePageCapture(request: Request) {
  let uploadedObjectKey = ""
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    const context = parseInscreenMaterialContext(body ?? {})
    const pageNumber = Number.parseInt(String(body?.pageNumber || ""), 10)
    const extractedText = normalizeInscreenPageText(String(body?.text || ""))
    const sourceType = body?.sourceType === "marker"
      ? "marker"
      : body?.sourceType === "clipboard"
        ? "clipboard"
        : "pdf"
    if (!Number.isInteger(pageNumber) || pageNumber < 1) {
      return Response.json({ error: "Invalid page number" }, { status: 400 })
    }

    const stage = await resolveInscreenStage(auth.session!, context)
    const pageKey = String(pageNumber)
    const reserved = await updateInscreenMaterialManifest(context, (manifest) => {
      if (!manifest.captures[pageKey]) {
        const timestamp = new Date().toISOString()
        manifest.captures[pageKey] = {
          id: crypto.randomUUID(),
          pageNumber,
          stageNumber: stage.currentStage,
          subjectSegment: context.subjectSegment,
          status: "pending",
          sourceType,
          r2Key: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        }
      }
      return manifest
    })
    const capture = reserved.captures[pageKey]
    if (capture.status === "complete") {
      return Response.json({ status: "duplicate", captureId: capture.id, r2Key: capture.r2Key })
    }
    if (extractedText.length < 30 && sourceType === "pdf") {
      return Response.json({ status: "needs-transcription", captureId: capture.id })
    }
    if (!extractedText) {
      return Response.json({ error: "La transcripción está vacía." }, { status: 400 })
    }

    const uploaded = await uploadNextInscreenText({
      subjectSegment: capture.subjectSegment,
      stageNumber: capture.stageNumber,
      kind: "pagina",
      body: extractedText,
      metadata: {
        ...inscreenMetadata(context, capture.stageNumber),
        "page-number": String(pageNumber),
        "text-source": sourceType,
      },
    })
    uploadedObjectKey = uploaded.objectKey
    const completed = await updateInscreenMaterialManifest(context, (manifest) => {
      const current = manifest.captures[pageKey]
      if (current?.id === capture.id && current.status === "pending") {
        current.status = "complete"
        current.sourceType = sourceType
        current.r2Key = uploaded.objectKey
        current.updatedAt = new Date().toISOString()
      }
      return manifest
    })
    const finalCapture = completed.captures[pageKey]
    if (finalCapture?.r2Key !== uploaded.objectKey) {
      await deleteR2Object(uploaded.objectKey)
      uploadedObjectKey = ""
      return Response.json({ status: "duplicate", captureId: finalCapture?.id ?? capture.id, r2Key: finalCapture?.r2Key })
    }

    return Response.json({ status: "complete", captureId: capture.id, r2Key: uploaded.objectKey })
  } catch (error) {
    if (uploadedObjectKey) await deleteR2Object(uploadedObjectKey).catch(() => undefined)
    console.error("POST /api/inscreen/page-captures error:", error)
    return inscreenErrorResponse(error)
  }
}

export async function POST(request: Request) {
  return withInscreenUserConfig(request, () => savePageCapture(request))
}
