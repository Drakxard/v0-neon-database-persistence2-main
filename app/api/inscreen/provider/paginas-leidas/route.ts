import { handleInscreenProviderGet } from "@/lib/inscreen-provider"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  return handleInscreenProviderGet(request, "pagina")
}
