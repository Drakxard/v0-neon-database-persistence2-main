import { requireAuthSession } from "@/lib/authz"
import { convertPdfPageWithDatalabMarker, DatalabMarkerError } from "@/lib/datalab-marker"

export const runtime = "nodejs"
export const maxDuration = 60

const MAX_PAGE_PDF_BYTES = 25 * 1024 * 1024

export async function POST(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const formData = await request.formData()
    const file = formData.get("file")
    if (!(file instanceof File) || file.type !== "application/pdf") {
      return Response.json({ error: "Se requiere un PDF de una pagina." }, { status: 400 })
    }
    if (!file.size || file.size > MAX_PAGE_PDF_BYTES) {
      return Response.json({ error: "El PDF de la pagina supera el limite permitido." }, { status: 413 })
    }

    const markdown = await convertPdfPageWithDatalabMarker({ file })
    return Response.json({ markdown })
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo transcribir la pagina con Marker."
    const status = error instanceof DatalabMarkerError ? 502 : 500
    console.error("POST /api/inscreen/marker-transcribe error:", error)
    return Response.json({ error: message }, { status })
  }
}
