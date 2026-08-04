import { requireAuthSession } from "@/lib/authz"
import { normalizeInscreenTitle } from "@/lib/inscreen"
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

export const runtime = "nodejs"

function uniqueStrings(value: unknown) {
  return Array.isArray(value)
    ? Array.from(new Set(value.map((item) => String(item || "").trim()).filter(Boolean)))
    : []
}

function uniquePages(value: unknown) {
  return Array.isArray(value)
    ? Array.from(new Set(value.map(Number).filter((page) => Number.isInteger(page) && page >= 1))).sort((a, b) => a - b)
    : []
}

export async function POST(request: Request) {
  let uploadedObjectKey = ""
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response
    const payload = await request.json().catch(() => null) as Record<string, unknown> | null
    const context = parseInscreenMaterialContext(payload ?? {})
    const requestId = String(payload?.requestId || "").trim()
    const title = normalizeInscreenTitle(String(payload?.title || ""))
    const noteBody = String(payload?.body || "").trim()
    const titleAnnotationId = String(payload?.titleAnnotationId || "").trim()
    const highlightAnnotationIds = uniqueStrings(payload?.highlightAnnotationIds)
    const pageNumbers = uniquePages(payload?.pageNumbers)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      return Response.json({ error: "Invalid request id" }, { status: 400 })
    }
    if (!title || !noteBody || !titleAnnotationId || highlightAnnotationIds.length === 0) {
      return Response.json({ error: "La nota necesita título y al menos un resaltado." }, { status: 400 })
    }

    const annotationIds = [titleAnnotationId, ...highlightAnnotationIds]
    const stage = await resolveInscreenStage(auth.session!, context)
    const reserved = await updateInscreenMaterialManifest(context, (manifest) => {
      const existing = manifest.focusedNotes[requestId]
      if (existing) {
        if (existing.annotationIds.join("\n") !== annotationIds.join("\n")) {
          throw new InscreenHttpError(409, "El identificador de esta nota ya pertenece a otra selección.")
        }
        return manifest
      }
      if (annotationIds.some((id) => manifest.consumedAnnotationIds.includes(id))) {
        throw new InscreenHttpError(409, "Una anotación de esta lectura ya fue utilizada.")
      }
      manifest.focusedNotes[requestId] = {
        status: "pending",
        annotationIds,
        r2Key: null,
        updatedAt: new Date().toISOString(),
      }
      return manifest
    })
    const note = reserved.focusedNotes[requestId]
    if (note.status === "complete") {
      return Response.json({ status: "duplicate", noteId: requestId, r2Key: note.r2Key })
    }

    const uploaded = await uploadNextInscreenText({
      subjectSegment: context.subjectSegment,
      stageNumber: stage.currentStage,
      kind: "material",
      body: `${title}\n${noteBody}`,
      metadata: {
        ...inscreenMetadata(context, stage.currentStage),
        "page-numbers": pageNumbers.join(","),
        "title-annotation-id": titleAnnotationId,
      },
    })
    uploadedObjectKey = uploaded.objectKey
    const completed = await updateInscreenMaterialManifest(context, (manifest) => {
      const current = manifest.focusedNotes[requestId]
      if (!current) throw new InscreenHttpError(409, "La reserva de la nota ya no existe.")
      if (current.status === "complete") return manifest
      if (annotationIds.some((id) => manifest.consumedAnnotationIds.includes(id))) {
        throw new InscreenHttpError(409, "Una anotación de esta lectura ya fue utilizada.")
      }
      current.status = "complete"
      current.r2Key = uploaded.objectKey
      current.updatedAt = new Date().toISOString()
      manifest.consumedAnnotationIds = Array.from(new Set([...manifest.consumedAnnotationIds, ...annotationIds]))
      return manifest
    })
    const finalNote = completed.focusedNotes[requestId]
    if (finalNote.r2Key !== uploaded.objectKey) {
      await deleteR2Object(uploaded.objectKey)
      uploadedObjectKey = ""
      return Response.json({ status: "duplicate", noteId: requestId, r2Key: finalNote.r2Key })
    }

    return Response.json({ status: "complete", noteId: requestId, r2Key: uploaded.objectKey })
  } catch (error) {
    if (uploadedObjectKey) await deleteR2Object(uploadedObjectKey).catch(() => undefined)
    console.error("POST /api/inscreen/focused-notes error:", error)
    return inscreenErrorResponse(error)
  }
}
