import { requireAuthSession } from "@/lib/authz"
import { buildInscreenConfigCookie, splitInscreenUserConfig } from "@/lib/inscreen-user-config"

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response
    const body = await request.json().catch(() => null)
    const { fileHalf, cookieHalf } = splitInscreenUserConfig(body)
    return Response.json(
      { fileHalf },
      {
        headers: {
          "Cache-Control": "no-store",
          "Set-Cookie": buildInscreenConfigCookie(cookieHalf),
        },
      }
    )
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo cifrar la configuracion." }, { status: 400 })
  }
}
