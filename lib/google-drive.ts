import { getGoogleAccessToken, getGoogleAccessTokenForRefreshToken } from "@/lib/google-oauth"
import { RemoteFileNotFoundError } from "@/lib/remote-file-errors"
import { WEEKDAY_NAMES } from "@/lib/subject-utils"

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3/files"
const DRIVE_RESUMABLE_UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,webViewLink"
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"

async function userDriveRequest(refreshToken: string, url: string, init?: RequestInit) {
  const accessToken = await getGoogleAccessTokenForRefreshToken(refreshToken)
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${accessToken}`, ...(init?.headers || {}) } })
  if (!response.ok) throw new Error((await response.text()) || "Google Drive request failed")
  return response
}

async function findUserFolder(refreshToken: string, name: string, parentId?: string) {
  const query = [`mimeType='${FOLDER_MIME_TYPE}'`, `name='${escapeDriveQueryValue(name)}'`, "trashed=false"]
  if (parentId) query.push(`'${parentId}' in parents`)
  const response = await userDriveRequest(refreshToken, `${DRIVE_API_BASE}?q=${encodeURIComponent(query.join(" and "))}&fields=files(id,name,webViewLink)&pageSize=1`)
  return ((await response.json()) as { files?: Array<{ id: string; name: string; webViewLink?: string }> }).files?.[0] || null
}

export async function ensureUserDriveFolder(refreshToken: string, name: string, parentId?: string) {
  const existing = await findUserFolder(refreshToken, name, parentId)
  if (existing) return existing
  const response = await userDriveRequest(refreshToken, `${DRIVE_API_BASE}?fields=id,name,webViewLink`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME_TYPE, ...(parentId ? { parents: [parentId] } : {}) }),
  })
  return response.json() as Promise<{ id: string; name: string; webViewLink?: string }>
}

export async function getUserDriveIdentity(refreshToken: string) {
  const response = await userDriveRequest(refreshToken, "https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)")
  return (await response.json()) as { user?: { displayName?: string; emailAddress?: string } }
}

export async function createUserDriveUploadSession(params: { refreshToken: string; rootFolderId: string; subjectName: string; weekNumber: number; containerName: string; fileName: string; mimeType: string }) {
  const subject = await ensureUserDriveFolder(params.refreshToken, params.subjectName.replace(/\n/g, " ").trim(), params.rootFolderId)
  const week = await ensureUserDriveFolder(params.refreshToken, `Semana ${params.weekNumber}`, subject.id)
  const container = await ensureUserDriveFolder(params.refreshToken, params.containerName.replace(/\n/g, " ").trim(), week.id)
  const response = await userDriveRequest(params.refreshToken, DRIVE_RESUMABLE_UPLOAD_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": params.mimeType },
    body: JSON.stringify({ name: params.fileName, mimeType: params.mimeType, parents: [container.id] }),
  })
  const uploadUrl = response.headers.get("location")
  if (!uploadUrl) throw new Error("Google Drive did not return a resumable upload URL.")
  return { uploadUrl }
}

export async function deleteUserDriveFile(refreshToken: string, fileId: string) {
  const accessToken = await getGoogleAccessTokenForRefreshToken(refreshToken)
  const response = await fetch(`${DRIVE_API_BASE}/${encodeURIComponent(fileId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } })
  if (response.status === 404) return
  if (!response.ok) throw new Error((await response.text()) || "Google Drive delete failed")
}

function requireRootFolderName() {
  return process.env.GOOGLE_DRIVE_ROOT_FOLDER_NAME || "Cursado2026"
}

function escapeDriveQueryValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

async function driveRequest(path: string, init?: RequestInit, options?: { fileId?: string }) {
  const accessToken = await getGoogleAccessToken()
  const response = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers || {}),
    },
  })

  if (response.status === 404 && options?.fileId) {
    throw new RemoteFileNotFoundError("drive", options.fileId, "The Google Drive file does not exist.")
  }

  if (!response.ok) {
    const payload = await response.text()
    throw new Error(payload || "Google Drive request failed")
  }

  return response
}

async function findFolderByName(name: string, parentId?: string) {
  const queryParts = [
    `mimeType='${FOLDER_MIME_TYPE}'`,
    `name='${escapeDriveQueryValue(name)}'`,
    "trashed=false",
  ]
  if (parentId) {
    queryParts.push(`'${parentId}' in parents`)
  }

  const url = `${DRIVE_API_BASE}?q=${encodeURIComponent(queryParts.join(" and "))}&fields=files(id,name)&pageSize=1`
  const response = await driveRequest(url)
  const payload = (await response.json()) as { files?: Array<{ id: string; name: string }> }
  return payload.files?.[0] || null
}

async function createFolder(name: string, parentId?: string) {
  const response = await driveRequest(DRIVE_API_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME_TYPE,
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  })

  return (await response.json()) as { id: string; name: string }
}

async function ensureFolder(name: string, parentId?: string) {
  const existing = await findFolderByName(name, parentId)
  if (existing) return existing.id
  const created = await createFolder(name, parentId)
  return created.id
}

export async function ensureSubjectFolderPath(subjectName: string, weekNumber: number, weekdayIndex: number) {
  const rootFolderId = await ensureFolder(requireRootFolderName())
  const subjectFolderId = await ensureFolder(subjectName.replace(/\n/g, " "), rootFolderId)
  const weekFolderId = await ensureFolder(`Semana ${weekNumber}`, subjectFolderId)
  const dayFolderId = await ensureFolder(WEEKDAY_NAMES[weekdayIndex] || `Dia ${weekdayIndex + 1}`, weekFolderId)
  return dayFolderId
}

export async function createDriveResumableUploadSession(params: {
  subjectName: string
  weekNumber: number
  weekdayIndex: number
  fileName: string
  mimeType: string
}) {
  const parentId = await ensureSubjectFolderPath(params.subjectName, params.weekNumber, params.weekdayIndex)
  const response = await driveRequest(DRIVE_RESUMABLE_UPLOAD_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": params.mimeType,
    },
    body: JSON.stringify({
      name: params.fileName,
      mimeType: params.mimeType,
      parents: [parentId],
    }),
  })

  const uploadUrl = response.headers.get("location")
  if (!uploadUrl) {
    throw new Error("Google Drive did not return a resumable upload URL.")
  }

  return {
    uploadUrl,
    fileName: params.fileName,
  }
}

export async function getDriveFileMetadata(fileId: string) {
  const response = await driveRequest(
    `${DRIVE_API_BASE}/${encodeURIComponent(fileId)}?fields=id,name,mimeType,webViewLink,size`,
    undefined,
    { fileId }
  )

  return (await response.json()) as {
    id: string
    name: string
    mimeType: string
    webViewLink?: string
    size?: string
  }
}

export async function downloadDriveFile(fileId: string) {
  const response = await driveRequest(`${DRIVE_API_BASE}/${fileId}?alt=media`, undefined, { fileId })
  const arrayBuffer = await response.arrayBuffer()
  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType: response.headers.get("content-type") || "application/octet-stream",
  }
}

export async function deleteDriveFile(fileId: string) {
  const accessToken = await getGoogleAccessToken()
  const response = await fetch(`${DRIVE_API_BASE}/${encodeURIComponent(fileId)}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (response.status === 404) {
    return { status: "missing" as const }
  }

  if (!response.ok) {
    const payload = await response.text()
    throw new Error(payload || "Google Drive delete failed")
  }

  return { status: "deleted" as const }
}
