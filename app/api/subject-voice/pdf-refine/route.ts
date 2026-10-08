import { requireAuthSession } from "@/lib/authz"
import { evaluatePdfWordUnits } from "@/lib/server/subject-pdf-words"
import type { PdfWordUnit } from "@/lib/subject-pdf-search"

export const runtime = "nodejs"
export const maxDuration = 60
export async function POST(request: Request) {
  const auth = await requireAuthSession()
  if (auth.response) return auth.response
  try {
    const body = await request.json() as { query: string; context: string; units: PdfWordUnit[] }
    if (typeof body.query !== "string" || !body.query.trim() || body.query.length > 500 || typeof body.context !== "string" || body.context.length > 180_000
      || !Array.isArray(body.units) || body.units.length < 1 || body.units.length > 64
      || body.units.some((u) => !u || typeof u.id !== "string" || typeof u.text !== "string")
      || JSON.stringify(body.units).length > 150_000) return Response.json({ error: "Las unidades del fragmento no son válidas." }, { status: 400 })
    return Response.json(await evaluatePdfWordUnits(body.query, body.context, body.units))
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo delimitar el fragmento." }, { status: 502 })
  }
}
