import { driveConfigCookie, readDriveUserConfig } from "@/lib/drive-user-config"
import { getUserDriveIdentity } from "@/lib/google-drive"
export const runtime = "nodejs"
export async function GET(request: Request) {
  try {
    const config = readDriveUserConfig(request)
    await getUserDriveIdentity(config.refreshToken)
    return Response.json({ connected: true, email: config.email, rootFolderName: config.rootFolderName, rootFolderLink: config.rootFolderLink }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return Response.json({ connected: false, error: error instanceof Error ? error.message : "Google Drive no esta conectado." }, { headers: { "Cache-Control": "no-store" } })
  }
}
export async function DELETE() { return Response.json({ connected: false }, { headers: { "Set-Cookie": driveConfigCookie("", 0), "Cache-Control": "no-store" } }) }
