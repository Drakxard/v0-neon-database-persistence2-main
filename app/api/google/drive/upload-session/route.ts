import { readDriveUserConfig } from "@/lib/drive-user-config"
import { prepareUserDriveUpload } from "@/lib/google-drive"
export const runtime = "nodejs"

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache" }

export async function POST(request: Request) {
  try {
    const config = readDriveUserConfig(request)
    const body = await request.json()
    const subjectName = String(body?.subjectName || "").trim()
    const containerName = String(body?.containerName || "").trim()
    const contentFingerprint = String(body?.contentFingerprint || "").trim().toLowerCase()
    const weekNumber = Number(body?.weekNumber)
    const materialId = Number(body?.materialId)
    const isPinned = body?.isPinned === true
    if (!subjectName || !containerName || !Number.isInteger(weekNumber) || weekNumber < 1 || !Number.isInteger(materialId) || !/^[a-f0-9]{64}$/.test(contentFingerprint)) {
      return Response.json({ error: "Datos de ubicacion o archivo incompletos." }, { status: 400, headers: NO_STORE_HEADERS })
    }
    const context = await prepareUserDriveUpload({
      refreshToken: config.refreshToken,
      rootFolderId: config.rootFolderId,
      subjectName,
      containerName,
      weekNumber,
      materialId,
      contentFingerprint,
      isPinned,
    })
    return Response.json(context, { headers: NO_STORE_HEADERS })
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo preparar Drive." }, { status: 500, headers: NO_STORE_HEADERS })
  }
}
