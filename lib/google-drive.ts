import { createHash } from "node:crypto"

import { getGoogleAccessToken, getGoogleAccessTokenDetailsForRefreshToken, getGoogleAccessTokenForRefreshToken } from "@/lib/google-oauth"
import { RemoteFileNotFoundError } from "@/lib/remote-file-errors"
import { WEEKDAY_NAMES } from "@/lib/subject-utils"

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3/files"
const DRIVE_RESUMABLE_UPLOAD_URL =
  "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,webViewLink"
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"
const SHORTCUT_MIME_TYPE = "application/vnd.google-apps.shortcut"

const pendingUserFolders = new Map<string, Promise<{ id: string; name: string; webViewLink?: string }>>()

async function userDriveRequest(refreshToken: string, url: string, init?: RequestInit, preparedAccessToken?: string) {
  const accessToken = preparedAccessToken || await getGoogleAccessTokenForRefreshToken(refreshToken)
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${accessToken}`, ...(init?.headers || {}) } })
  if (!response.ok) throw new Error((await response.text()) || "Google Drive request failed")
  return response
}

async function findUserFolder(refreshToken: string, name: string, parentId?: string, accessToken?: string) {
  const query = [`mimeType='${FOLDER_MIME_TYPE}'`, `name='${escapeDriveQueryValue(name)}'`, "trashed=false"]
  if (parentId) query.push(`'${parentId}' in parents`)
  const response = await userDriveRequest(refreshToken, `${DRIVE_API_BASE}?q=${encodeURIComponent(query.join(" and "))}&fields=files(id,name,webViewLink)&pageSize=1`, undefined, accessToken)
  return ((await response.json()) as { files?: Array<{ id: string; name: string; webViewLink?: string }> }).files?.[0] || null
}

async function listUserWeekFolders(refreshToken: string, parentId: string, accessToken: string) {
  const query = [`mimeType='${FOLDER_MIME_TYPE}'`, `'${escapeDriveQueryValue(parentId)}' in parents`, "trashed=false"]
  const response = await userDriveRequest(refreshToken, `${DRIVE_API_BASE}?q=${encodeURIComponent(query.join(" and "))}&fields=files(id,name,webViewLink)&pageSize=1000`, undefined, accessToken)
  return (((await response.json()) as { files?: Array<{ id: string; name: string; webViewLink?: string }> }).files ?? [])
    .filter((folder) => /^Semana \d+$/.test(folder.name))
}

async function ensureUserDriveShortcut(refreshToken: string, parentId: string, targetId: string, accessToken: string) {
  const query = [
    `mimeType='${SHORTCUT_MIME_TYPE}'`,
    `name='Fijos'`,
    `'${escapeDriveQueryValue(parentId)}' in parents`,
    "trashed=false",
  ]
  const existing = await userDriveRequest(refreshToken, `${DRIVE_API_BASE}?q=${encodeURIComponent(query.join(" and "))}&fields=files(id,shortcutDetails(targetId))&pageSize=100`, undefined, accessToken)
  const shortcuts = ((await existing.json()) as { files?: Array<{ id: string; shortcutDetails?: { targetId?: string } }> }).files ?? []
  if (shortcuts.some((shortcut) => shortcut.shortcutDetails?.targetId === targetId)) return
  await userDriveRequest(refreshToken, `${DRIVE_API_BASE}?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Fijos", mimeType: SHORTCUT_MIME_TYPE, parents: [parentId], shortcutDetails: { targetId } }),
  }, accessToken)
}

export async function ensureUserDriveFolder(refreshToken: string, name: string, parentId?: string, accessToken?: string) {
  const safeName = name.replace(/\n/g, " ").trim()
  const lockKey = createHash("sha256").update(`${refreshToken}\0${parentId || "root"}\0${safeName}`).digest("hex")
  const inFlight = pendingUserFolders.get(lockKey)
  if (inFlight) return inFlight

  const operation = (async () => {
    const existing = await findUserFolder(refreshToken, safeName, parentId, accessToken)
    if (existing) return existing
    const response = await userDriveRequest(refreshToken, `${DRIVE_API_BASE}?fields=id,name,webViewLink`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: safeName, mimeType: FOLDER_MIME_TYPE, ...(parentId ? { parents: [parentId] } : {}) }),
    }, accessToken)
    return response.json() as Promise<{ id: string; name: string; webViewLink?: string }>
  })()

  pendingUserFolders.set(lockKey, operation)
  try {
    return await operation
  } finally {
    if (pendingUserFolders.get(lockKey) === operation) pendingUserFolders.delete(lockKey)
  }
}

export async function getUserDriveIdentity(refreshToken: string) {
  const response = await userDriveRequest(refreshToken, "https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)")
  return (await response.json()) as { user?: { displayName?: string; emailAddress?: string } }
}

async function findUploadedUserMaterial(refreshToken: string, accessToken: string, parentId: string, materialId: number, contentFingerprint: string) {
  const query = [
    `'${escapeDriveQueryValue(parentId)}' in parents`,
    "trashed=false",
    `appProperties has { key='cursadoMaterialId' and value='${escapeDriveQueryValue(String(materialId))}' }`,
    `appProperties has { key='cursadoContentSha256' and value='${escapeDriveQueryValue(contentFingerprint)}' }`,
  ]
  const response = await userDriveRequest(
    refreshToken,
    `${DRIVE_API_BASE}?q=${encodeURIComponent(query.join(" and "))}&fields=files(id,name,mimeType,webViewLink)&pageSize=1`,
    undefined,
    accessToken,
  )
  return ((await response.json()) as { files?: Array<{ id: string; name: string; mimeType: string; webViewLink?: string }> }).files?.[0] || null
}

export async function prepareUserDriveUpload(params: { refreshToken: string; rootFolderId: string; subjectName: string; weekNumber: number; containerName: string; materialId: number; contentFingerprint: string; isPinned?: boolean }) {
  const token = await getGoogleAccessTokenDetailsForRefreshToken(params.refreshToken)
  const subject = await ensureUserDriveFolder(params.refreshToken, params.subjectName, params.rootFolderId, token.accessToken)
  const existingFixed = await findUserFolder(params.refreshToken, "Fijos", subject.id, token.accessToken)
  const fixed = params.isPinned
    ? existingFixed ?? await ensureUserDriveFolder(params.refreshToken, "Fijos", subject.id, token.accessToken)
    : existingFixed
  const week = params.isPinned ? null : await ensureUserDriveFolder(params.refreshToken, `Semana ${params.weekNumber}`, subject.id, token.accessToken)
  if (fixed) {
    const weeks = week ? [week] : await listUserWeekFolders(params.refreshToken, subject.id, token.accessToken)
    await Promise.all(weeks.map((candidate) => ensureUserDriveShortcut(params.refreshToken, candidate.id, fixed.id, token.accessToken)))
  }
  const parent = params.isPinned ? fixed! : week!
  const container = await ensureUserDriveFolder(params.refreshToken, params.containerName, parent.id, token.accessToken)
  const existingFile = await findUploadedUserMaterial(params.refreshToken, token.accessToken, container.id, params.materialId, params.contentFingerprint)
  const destination = {
    isPinned: params.isPinned === true,
    subjectFolderId: subject.id,
    weekFolderId: week?.id ?? null,
    weekFolderUrl: week?.webViewLink || (week ? `https://drive.google.com/drive/folders/${encodeURIComponent(week.id)}` : null),
    fixedFolderId: fixed?.id ?? null,
  }
  if (existingFile) return { existingFile, destination }

  return {
    accessToken: token.accessToken,
    expiresAt: new Date(Date.now() + token.expiresIn * 1000).toISOString(),
    parentFolderId: container.id,
    appProperties: {
      cursadoMaterialId: String(params.materialId),
      cursadoContentSha256: params.contentFingerprint,
    },
    destination,
  }
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
