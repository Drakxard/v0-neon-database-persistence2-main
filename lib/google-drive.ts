import { getGoogleAccessToken } from "@/lib/google-oauth"
import { WEEKDAY_NAMES } from "@/lib/subject-utils"

const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3/files"
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,webViewLink"
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"

function requireRootFolderName() {
  return process.env.GOOGLE_DRIVE_ROOT_FOLDER_NAME || "Cursado2026"
}

function escapeDriveQueryValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
}

async function driveRequest(path: string, init?: RequestInit) {
  const accessToken = await getGoogleAccessToken()
  const response = await fetch(path, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.headers || {}),
    },
  })

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

export async function uploadFileToDrive(params: {
  subjectName: string
  weekNumber: number
  weekdayIndex: number
  fileName: string
  mimeType: string
  fileBuffer: Buffer
}) {
  const parentId = await ensureSubjectFolderPath(params.subjectName, params.weekNumber, params.weekdayIndex)
  const boundary = `boundary-${Date.now()}`
  const metadata = {
    name: params.fileName,
    mimeType: params.mimeType,
    parents: [parentId],
  }

  const preamble = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${params.mimeType}\r\n\r\n`,
    "utf8"
  )
  const closing = Buffer.from(`\r\n--${boundary}--`, "utf8")
  const body = Buffer.concat([preamble, params.fileBuffer, closing])

  const response = await driveRequest(DRIVE_UPLOAD_URL, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  })

  return (await response.json()) as {
    id: string
    name: string
    mimeType: string
    webViewLink: string
  }
}

export async function uploadAudioToDrive(params: {
  subjectName: string
  weekNumber: number
  weekdayIndex: number
  fileName: string
  mimeType: string
  fileBuffer: Buffer
}) {
  return uploadFileToDrive(params)
}

export async function downloadDriveFile(fileId: string) {
  const response = await driveRequest(`${DRIVE_API_BASE}/${fileId}?alt=media`)
  const arrayBuffer = await response.arrayBuffer()
  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType: response.headers.get("content-type") || "application/octet-stream",
  }
}
