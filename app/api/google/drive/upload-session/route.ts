import { readDriveUserConfig } from "@/lib/drive-user-config"
import { createUserDriveUploadSession } from "@/lib/google-drive"
export const runtime = "nodejs"
export async function POST(request: Request) {
  try {
    const config = readDriveUserConfig(request)
    const body = await request.json()
    const subjectName = String(body?.subjectName || "").trim(), containerName = String(body?.containerName || "").trim(), fileName = String(body?.fileName || "").trim()
    const weekNumber = Number(body?.weekNumber)
    if (!subjectName || !containerName || !Number.isInteger(weekNumber) || !fileName) return Response.json({ error: "Datos de ubicacion incompletos." }, { status: 400 })
    return Response.json(await createUserDriveUploadSession({ refreshToken: config.refreshToken, rootFolderId: config.rootFolderId, subjectName, containerName, weekNumber, fileName, mimeType: "application/pdf" }))
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "No se pudo preparar Drive." }, { status: 500 }) }
}
