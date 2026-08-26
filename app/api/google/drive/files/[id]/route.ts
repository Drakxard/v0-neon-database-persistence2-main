import { readDriveUserConfig } from "@/lib/drive-user-config"
import { deleteUserDriveFile } from "@/lib/google-drive"
export const runtime = "nodejs"
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const config = readDriveUserConfig(request); const { id } = await context.params; await deleteUserDriveFile(config.refreshToken, id); return Response.json({ success: true }) }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "No se pudo eliminar el archivo de Drive." }, { status: 500 }) }
}
