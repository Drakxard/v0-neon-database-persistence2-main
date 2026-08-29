import { driveConfigCookie, readLegacyDriveUserConfig, sealDriveUserConfig } from "@/lib/drive-user-config"
import { getUserDriveIdentity } from "@/lib/google-drive"
import { getInscreenConfigSeedFingerprint } from "@/lib/inscreen-user-config"

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as { fileHalf?: string } | null
    const config = readLegacyDriveUserConfig(request, String(body?.fileHalf || ""))
    await getUserDriveIdentity(config.refreshToken)
    return Response.json({ driveToken: sealDriveUserConfig(config), seedFingerprint: getInscreenConfigSeedFingerprint() }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo migrar Google Drive." }, { status: 400, headers: { "Cache-Control": "no-store" } })
  }
}

export async function DELETE() {
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store", "Set-Cookie": driveConfigCookie("", 0) } })
}
