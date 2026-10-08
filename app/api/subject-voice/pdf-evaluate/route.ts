import { requireAuthSession } from "@/lib/authz"
import { evaluatePdfCandidate } from "@/lib/server/subject-pdf-clef"
import type { PdfCandidate } from "@/lib/subject-pdf-search"

export const runtime = "nodejs"
export const maxDuration = 60
export async function POST(request: Request) {
  const auth = await requireAuthSession()
  if (auth.response) return auth.response
  try {
    const body = await request.json() as { query?: unknown; candidate?: PdfCandidate }
    const candidate = body.candidate
    if (typeof body.query !== "string" || !body.query.trim() || body.query.length > 500 || !candidate || typeof candidate.id !== "string"
      || !Array.isArray(candidate.anchorIds) || !candidate.anchorIds.every((id) => typeof id === "string")
      || !Array.isArray(candidate.blocks) || candidate.blocks.length < 1 || candidate.blocks.length > 48
      || candidate.blocks.some((b) => !b || typeof b.id !== "string" || typeof b.text !== "string" || typeof b.type !== "string" || !Number.isInteger(b.page))
      || JSON.stringify(candidate).length > 250_000) return Response.json({ error: "La consulta o el fragmento no son válidos." }, { status: 400 })
    return Response.json(await evaluatePdfCandidate(body.query, candidate))
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo filtrar con Clef." }, { status: 502 })
  }
}
