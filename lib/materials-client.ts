import { uploadBlobToStorage, type DriveUploadSessionResponse } from "@/lib/client-storage-upload"
import { requireOkJson } from "@/lib/client/api"
import type { SubjectDayMaterial, SubjectDayMaterialType } from "@/lib/study-types"

type SubjectMaterialUploadContext = {
  subjectId: string
  subjectName: string
  sessionDate: string
  weekNumber: number
  materialType: SubjectDayMaterialType
  containerId?: number | null
}

export async function uploadSubjectDayMaterial(
  context: SubjectMaterialUploadContext,
  file: Blob,
  fileName: string,
  mimeType = file.type || "application/pdf"
) {
  const sessionResponse = await fetch("/api/subject-day-materials/upload-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...context,
      fileName,
      mimeType,
    }),
  })
  const sessionPayload = await requireOkJson<DriveUploadSessionResponse>(
    sessionResponse,
    `No se pudo preparar la subida de ${fileName}.`
  )

  const { driveFileId } = await uploadBlobToStorage(sessionPayload, file)
  const completeResponse = await fetch("/api/subject-day-materials/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subjectId: context.subjectId,
      subjectName: context.subjectName,
      sessionDate: context.sessionDate,
      weekNumber: context.weekNumber,
      materialType: context.materialType,
      containerId: context.containerId,
      driveFileId,
      fileName: fileName.trim(),
    }),
  })

  return requireOkJson<SubjectDayMaterial>(completeResponse, `No se pudo confirmar ${fileName}.`)
}
