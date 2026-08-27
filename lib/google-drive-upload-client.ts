const DRIVE_RESUMABLE_UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,webViewLink"

// Google exige que todos los fragmentos salvo el ultimo sean multiplos de 256 KiB.
export const DRIVE_UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024

type UploadedDriveFile = { id: string; name?: string; mimeType?: string; webViewLink?: string }

type DriveUploadContext = {
  accessToken?: string
  expiresAt?: string
  parentFolderId?: string
  replaceFileId?: string
  appProperties?: Record<string, string>
  existingFile?: UploadedDriveFile
  destination?: {
    isPinned: boolean
    subjectFolderId: string
    weekFolderId: string | null
    weekFolderUrl: string | null
    fixedFolderId: string | null
  }
  error?: string
}

class RestartDriveUploadError extends Error {}

function statusError(stage: string, status: number) {
  if (status === 401 || status === 404 || status === 410) throw new RestartDriveUploadError(`${stage}: la sesion temporal vencio.`)
  throw new Error(`${stage}: Google Drive respondio ${status}.`)
}

async function sha256(blob: Blob) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")
}

async function requestUploadContext(item: object, contentFingerprint: string) {
  let response: Response
  try {
    response = await fetch("/api/google/drive/upload-session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...item, contentFingerprint }),
      cache: "no-store",
    })
  } catch {
    throw new Error("Preparar Drive: no se pudo contactar al servidor.")
  }
  const context = await response.json().catch(() => null) as DriveUploadContext | null
  if (!response.ok) throw new Error(`Preparar Drive: ${context?.error || `el servidor respondio ${response.status}.`}`)
  if (context?.existingFile?.id) return context
  if (!context?.accessToken || !context.parentFolderId || !context.appProperties) {
    throw new Error("Preparar Drive: faltan los datos temporales de subida.")
  }
  return context
}

async function startResumableUpload(context: DriveUploadContext, fileName: string, file: Blob) {
  let response: Response
  try {
    const uploadUrl = context.replaceFileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(context.replaceFileId)}?uploadType=resumable&fields=id,name,mimeType,webViewLink`
      : DRIVE_RESUMABLE_UPLOAD_URL
    response = await fetch(uploadUrl, {
      method: context.replaceFileId ? "PATCH" : "POST",
      headers: {
        Authorization: `Bearer ${context.accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "application/pdf",
        "X-Upload-Content-Length": String(file.size),
      },
      body: JSON.stringify({
        name: fileName,
        mimeType: "application/pdf",
        ...(context.replaceFileId ? {} : { parents: [context.parentFolderId] }),
        appProperties: context.appProperties,
      }),
    })
  } catch {
    throw new Error("Iniciar subida: no se pudo conectar directamente con Google Drive.")
  }
  if (!response.ok) statusError("Iniciar subida", response.status)
  const uploadUrl = response.headers.get("Location")
  if (!uploadUrl) throw new Error("Iniciar subida: Google Drive no devolvio la URL resumible.")
  return uploadUrl
}

async function transferChunks(uploadUrl: string, file: Blob) {
  let offset = 0
  while (offset < file.size) {
    const endExclusive = Math.min(offset + DRIVE_UPLOAD_CHUNK_SIZE, file.size)
    let response: Response
    try {
      response = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "application/pdf",
          "Content-Range": `bytes ${offset}-${endExclusive - 1}/${file.size}`,
        },
        body: file.slice(offset, endExclusive, "application/pdf"),
      })
    } catch {
      throw new Error("Transferir PDF: se interrumpio la conexion directa con Google Drive.")
    }

    if (response.status === 308) {
      offset = endExclusive
      continue
    }
    if (!response.ok) statusError("Transferir PDF", response.status)
    const uploaded = await response.json().catch(() => null) as UploadedDriveFile | null
    if (!uploaded?.id) throw new Error("Confirmar Drive: Google no devolvio el identificador del archivo.")
    return uploaded
  }
  throw new Error("Transferir PDF: el archivo esta vacio.")
}

export async function uploadPdfDirectlyToDrive(item: { fileName: string } & Record<string, unknown>, file: Blob) {
  const contentFingerprint = await sha256(file)
  let lastRestartError: Error | null = null

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const context = await requestUploadContext(item, contentFingerprint)
    if (context.existingFile?.id) return { ...context.existingFile, destination: context.destination }
    try {
      return { ...(await transferChunks(await startResumableUpload(context, item.fileName, file), file)), destination: context.destination }
    } catch (error) {
      if (!(error instanceof RestartDriveUploadError)) throw error
      lastRestartError = error
    }
  }
  throw lastRestartError || new Error("Transferir PDF: no se pudo renovar la sesion temporal.")
}
