import { requireAuthSession } from "@/lib/authz"
import { CLEF_FLASH_MODEL, getClefConfiguration } from "@/lib/server/cloudflare-clef"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const auth = await requireAuthSession()
  if (auth.response) return auth.response
  const { configured, missing } = getClefConfiguration()
  return Response.json(
    { model: CLEF_FLASH_MODEL, configured, ...(!configured ? { missing } : {}) },
    { status: configured ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  )
}
