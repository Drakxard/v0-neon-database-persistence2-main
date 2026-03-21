export type DriveUploadSessionResponse = {
  uploadMode: "server" | "direct"
  objectKey: string
  fileName: string
  driveFileId?: string
  mimeType?: string
  metadata?: Record<string, string>
  headers?: Record<string, string>
  uploadUrl?: string
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
    return payload.error
  }

  if (typeof payload === "string" && payload.trim().length > 0) {
    return payload
  }

  return fallback
}

async function parseJsonResponse(response: Response) {
  const text = await response.text()
  if (!text) return null

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export async function uploadBlobToStorage(session: DriveUploadSessionResponse, blob: Blob) {
  if (session.uploadMode === "direct") {
    if (!session.uploadUrl) {
      throw new Error("Falta la URL firmada para subir el archivo al storage.")
    }

    const response = await fetch(session.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": session.mimeType || blob.type || "application/octet-stream",
        ...(session.headers || {}),
      },
      body: blob,
    })

    if (!response.ok) {
      const payload = await parseJsonResponse(response)
      const fallback = `No se pudo subir el archivo al storage. (${response.status})`
      throw new Error(getErrorMessage(payload, fallback))
    }

    const driveFileId = session.driveFileId || session.objectKey || ""
    if (!driveFileId) {
      throw new Error("El storage no devolvio el identificador del archivo subido.")
    }

    return {
      driveFileId,
      payload: null,
    }
  }

  if (session.uploadMode !== "server") {
    throw new Error("Unsupported upload mode.")
  }

  const formData = new FormData()
  formData.set("file", blob, session.fileName)
  formData.set("objectKey", session.objectKey)
  formData.set("mimeType", session.mimeType || blob.type || "application/octet-stream")

  if (session.metadata && Object.keys(session.metadata).length > 0) {
    formData.set("metadata", JSON.stringify(session.metadata))
  }

  const response = await fetch("/api/storage/r2-upload", {
    method: "POST",
    body: formData,
  })

  const payload = await parseJsonResponse(response)
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, "No se pudo subir el archivo al storage."))
  }

  const driveFileId =
    (payload && typeof payload === "object" && "driveFileId" in payload && typeof payload.driveFileId === "string"
      ? payload.driveFileId
      : "") ||
    session.driveFileId ||
    ""

  if (!driveFileId) {
    throw new Error("El storage no devolvio el identificador del archivo subido.")
  }

  return {
    driveFileId,
    payload,
  }
}
