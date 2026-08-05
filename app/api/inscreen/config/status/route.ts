import { withInscreenUserConfig } from "@/lib/inscreen-user-config"

export const runtime = "nodejs"

export async function GET(request: Request) {
  return withInscreenUserConfig(request, async () => Response.json({ configured: true }))
}
