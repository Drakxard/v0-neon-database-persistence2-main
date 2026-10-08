import { requireAuthSession } from "@/lib/authz"
import { INSCREEN_CONFIG_TOKEN_HEADER, withInscreenUserConfig } from "@/lib/inscreen-user-config"
import { DatalabJobError, pollDatalabFragments, submitDatalabFragments } from "@/lib/server/datalab-fragments"
import { PDF_BATCH_BYTES } from "@/lib/subject-pdf-search"

export const runtime = "nodejs"
export const maxDuration = 60
export const dynamic = "force-dynamic"
async function handle(request: Request) {
  const auth = await requireAuthSession()
  if (auth.response) return auth.response
  try {
    if (request.method === "GET") {
      const token = new URL(request.url).searchParams.get("token") ?? ""
      return Response.json(await pollDatalabFragments(token, auth.session!.email), { headers: { "Cache-Control": "no-store" } })
    }
    const form = await request.formData()
    const file = form.get("file")
    if (!(file instanceof File) || file.type !== "application/pdf" || !file.size) return Response.json({ error: "Se requiere un PDF válido." }, { status: 400 })
    if (file.size > PDF_BATCH_BYTES) return Response.json({ error: "El lote supera 3 MiB." }, { status: 413 })
    return Response.json(await submitDatalabFragments(file, auth.session!.email, form.get("words") === "true"))
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo extraer el PDF." }, { status: error instanceof DatalabJobError ? error.status : 502 })
  }
}
function configuredHandle(request: Request) {
  if (process.env.datalab?.trim() || process.env.MARKER_API?.trim() || process.env.marker_api?.trim() || !request.headers.get(INSCREEN_CONFIG_TOKEN_HEADER)) return handle(request)
  return withInscreenUserConfig(request, () => handle(request))
}
export async function POST(request: Request) { return configuredHandle(request) }
export async function GET(request: Request) { return configuredHandle(request) }
