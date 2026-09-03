export const runtime = "nodejs"
export const dynamic = "force-dynamic"

function localOnlyResponse() {
  return Response.json(
    { error: "La sincronización R2 de Síntesis está desactivada. Los datos se guardan solo en este dispositivo." },
    { status: 503, headers: { "Cache-Control": "no-store" } }
  )
}

export async function GET() {
  return localOnlyResponse()
}

export async function PUT() {
  return localOnlyResponse()
}
