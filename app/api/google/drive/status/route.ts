import { readDriveUserConfig } from "@/lib/drive-user-config"
import { getUserDriveIdentity } from "@/lib/google-drive"
import { getInscreenConfigSeedFingerprint } from "@/lib/inscreen-user-config"
export const runtime = "nodejs"
export async function GET(request: Request) {
  try {
    const config = readDriveUserConfig(request)
    await getUserDriveIdentity(config.refreshToken)
    return Response.json({ connected: true, email: config.email, rootFolderName: config.rootFolderName, rootFolderLink: config.rootFolderLink }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    let seedFingerprint = ""
    try { seedFingerprint = getInscreenConfigSeedFingerprint() } catch {}
    return Response.json({ connected: false, code: seedFingerprint ? "seed_mismatch_or_corrupt_or_revoked" : "seed_missing", seedFingerprint, error: error instanceof Error ? error.message : "Google Drive no esta conectado." }, { headers: { "Cache-Control": "no-store" } })
  }
}
export async function DELETE() { return Response.json({ connected: false }, { headers: { "Cache-Control": "no-store" } }) }
