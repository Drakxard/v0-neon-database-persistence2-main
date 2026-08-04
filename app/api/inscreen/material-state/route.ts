import { requireAuthSession } from "@/lib/authz"
import {
  inscreenErrorResponse,
  parseInscreenMaterialContext,
  readInscreenMaterialManifest,
} from "@/lib/inscreen-server"

export const runtime = "nodejs"

export async function GET(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response
    const context = parseInscreenMaterialContext(new URL(request.url).searchParams)
    const material = await readInscreenMaterialManifest(context)
    const captures = Object.values(material.value.captures)

    return Response.json({
      contentRevision: context.contentRevision,
      capturedPages: captures.filter((capture) => capture.status === "complete").map((capture) => capture.pageNumber),
      pendingCaptures: captures.filter((capture) => capture.status === "pending").map((capture) => ({
        id: capture.id,
        pageNumber: capture.pageNumber,
      })),
      consumedAnnotationIds: material.value.consumedAnnotationIds,
    })
  } catch (error) {
    console.error("GET /api/inscreen/material-state error:", error)
    return inscreenErrorResponse(error)
  }
}
