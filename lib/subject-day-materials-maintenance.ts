import { deleteDriveFile } from "@/lib/google-drive"
import { deleteR2Object, isR2ObjectKey } from "@/lib/r2"

type RemoteDeleteResult =
  | { status: "deleted" }
  | { status: "missing" }
  | { status: "unavailable"; error: unknown }

export async function deleteSubjectDayMaterialRemoteFile(params: {
  materialId: number
  driveFileId: string
}): Promise<RemoteDeleteResult> {
  const driveFileId = params.driveFileId.trim()
  if (!driveFileId) {
    console.warn("Subject day material is missing drive_file_id during delete", {
      materialId: params.materialId,
      drive_file_id: params.driveFileId,
      reason: "empty-drive-file-id",
    })
    return { status: "missing" }
  }

  try {
    const result = isR2ObjectKey(driveFileId)
      ? await deleteR2Object(driveFileId)
      : await deleteDriveFile(driveFileId)

    if (result.status === "missing") {
      console.warn("Subject day material remote file already missing during delete", {
        materialId: params.materialId,
        drive_file_id: driveFileId,
        reason: "remote-file-missing",
      })
    }

    return result
  } catch (error) {
    console.warn("Subject day material remote delete failed; deleting DB row anyway", {
      materialId: params.materialId,
      drive_file_id: driveFileId,
      reason: "remote-delete-failed",
      error: error instanceof Error ? error.message : String(error),
    })
    return { status: "unavailable", error }
  }
}
