import { neon } from "@neondatabase/serverless"

import { downloadDriveFile, getDriveFileMetadata } from "@/lib/google-drive"
import { isRemoteFileNotFoundError } from "@/lib/remote-file-errors"
import { downloadR2Object, getR2ObjectMetadata, isR2ObjectKey } from "@/lib/r2"

const sql = neon(process.env.DATABASE_URL!)

export type SubjectDayMaterialStorageRecord = {
  id: number
  drive_file_id: string
}

type MaterialRemoteMetadata = Awaited<ReturnType<typeof getR2ObjectMetadata>> | Awaited<ReturnType<typeof getDriveFileMetadata>>
type MaterialRemoteFile = Awaited<ReturnType<typeof downloadR2Object>> | Awaited<ReturnType<typeof downloadDriveFile>>

async function cleanupMissingSubjectDayMaterial(materialId: number) {
  await sql`
    DELETE FROM subject_day_materials
    WHERE id = ${materialId}
  `
}

async function withSubjectDayMaterialAutocleanup<T>(
  material: SubjectDayMaterialStorageRecord,
  operation: () => Promise<T>
): Promise<{ status: "ok"; value: T } | { status: "missing" }> {
  try {
    const value = await operation()
    return { status: "ok", value }
  } catch (error) {
    if (isRemoteFileNotFoundError(error)) {
      await cleanupMissingSubjectDayMaterial(material.id)
      return { status: "missing" }
    }

    throw error
  }
}

export async function getSubjectDayMaterialMetadataOrAutocleanup(material: SubjectDayMaterialStorageRecord) {
  return withSubjectDayMaterialAutocleanup<MaterialRemoteMetadata>(material, () =>
    isR2ObjectKey(material.drive_file_id)
      ? getR2ObjectMetadata(material.drive_file_id)
      : getDriveFileMetadata(material.drive_file_id)
  )
}

export async function downloadSubjectDayMaterialFileOrAutocleanup(material: SubjectDayMaterialStorageRecord) {
  return withSubjectDayMaterialAutocleanup<MaterialRemoteFile>(material, () =>
    isR2ObjectKey(material.drive_file_id)
      ? downloadR2Object(material.drive_file_id)
      : downloadDriveFile(material.drive_file_id)
  )
}
