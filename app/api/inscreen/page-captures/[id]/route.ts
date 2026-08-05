import { requireAuthSession } from "@/lib/authz"
import { normalizeInscreenPageText } from "@/lib/inscreen"
import {
  inscreenErrorResponse,
  inscreenMetadata,
  parseInscreenMaterialContext,
  readInscreenMaterialManifest,
  updateInscreenMaterialManifest,
  uploadNextInscreenText,
} from "@/lib/inscreen-server"
import { deleteR2Object } from "@/lib/r2"
import { withInscreenUserConfig } from "@/lib/inscreen-user-config"

export const runtime = "nodejs"

async function updatePageCapture(request: Request, routeContext: { params: Promise<{ id: string }> }) {
  let uploadedObjectKey = ""
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response
    const captureId = String((await routeContext.params).id || "").trim()
    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    const context = parseInscreenMaterialContext(body ?? {})
    const text = normalizeInscreenPageText(String(body?.text || ""))
    if (!captureId || !text) {
      return Response.json({ error: "Invalid capture or empty transcription" }, { status: 400 })
    }

    const snapshot = await readInscreenMaterialManifest(context)
    const capture = Object.values(snapshot.value.captures).find((candidate) => candidate.id === captureId)
    if (!capture) return Response.json({ error: "Capture not found" }, { status: 404 })
    if (capture.status === "complete") {
      return Response.json({ status: "duplicate", captureId, r2Key: capture.r2Key })
    }

    const uploaded = await uploadNextInscreenText({
      subjectSegment: capture.subjectSegment,
      stageNumber: capture.stageNumber,
      kind: "pagina",
      body: text,
      metadata: {
        ...inscreenMetadata(context, capture.stageNumber),
        "page-number": String(capture.pageNumber),
        "text-source": "clipboard",
      },
    })
    uploadedObjectKey = uploaded.objectKey
    const pageKey = String(capture.pageNumber)
    const completed = await updateInscreenMaterialManifest(context, (manifest) => {
      const current = manifest.captures[pageKey]
      if (current?.id === captureId && current.status === "pending") {
        current.status = "complete"
        current.sourceType = "clipboard"
        current.r2Key = uploaded.objectKey
        current.updatedAt = new Date().toISOString()
      }
      return manifest
    })
    const finalCapture = completed.captures[pageKey]
    if (finalCapture?.r2Key !== uploaded.objectKey) {
      await deleteR2Object(uploaded.objectKey)
      uploadedObjectKey = ""
      return Response.json({ status: "duplicate", captureId, r2Key: finalCapture?.r2Key })
    }

    return Response.json({ status: "complete", captureId, r2Key: uploaded.objectKey })
  } catch (error) {
    if (uploadedObjectKey) await deleteR2Object(uploadedObjectKey).catch(() => undefined)
    console.error("PUT /api/inscreen/page-captures/[id] error:", error)
    return inscreenErrorResponse(error)
  }
}

export async function PUT(request: Request, routeContext: { params: Promise<{ id: string }> }) {
  return withInscreenUserConfig(request, () => updatePageCapture(request, routeContext))
}
