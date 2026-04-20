import { uploadBlobToStorage, type DriveUploadSessionResponse } from "@/lib/client-storage-upload"
import { requireOkJson } from "@/lib/client/api"
import type { CronogramaRecord } from "@/lib/study-types"

export async function fetchCronograma() {
  const response = await fetch("/api/cronograma", {
    cache: "no-store",
  })
  return requireOkJson<CronogramaRecord | null>(response, "No se pudo cargar el cronograma.")
}

export async function uploadCronogramaPdf(file: File) {
  const fileName = file.name.trim()
  const mimeType = file.type || "application/pdf"

  const sessionResponse = await fetch("/api/cronograma/upload-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fileName,
      mimeType,
    }),
  })
  const sessionPayload = await requireOkJson<DriveUploadSessionResponse>(
    sessionResponse,
    `No se pudo preparar la subida de ${fileName}.`
  )

  const { driveFileId } = await uploadBlobToStorage(sessionPayload, file)
  const completeResponse = await fetch("/api/cronograma/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      driveFileId,
      fileName,
    }),
  })

  return requireOkJson<CronogramaRecord>(completeResponse, `No se pudo confirmar ${fileName}.`)
}
