import { readDriveUserConfig } from "@/lib/drive-user-config"
import { cleanupUserDriveDuplicatePdfs } from "@/lib/google-drive"

export const runtime = "nodejs"

export async function POST(request: Request) {
  try {
    const config = readDriveUserConfig(request)
    const body = await request.json().catch(() => ({}))
    const referencedFileIds = Array.isArray(body?.referencedFileIds)
      ? body.referencedFileIds.map((value: unknown) => String(value || "").trim()).filter(Boolean)
      : []
    return Response.json(await cleanupUserDriveDuplicatePdfs({
      refreshToken: config.refreshToken,
      rootFolderId: config.rootFolderId,
      referencedFileIds,
    }), { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "No se pudieron limpiar los duplicados de Drive." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    )
  }
}
