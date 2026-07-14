import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

import { RemoteFileNotFoundError } from "@/lib/remote-file-errors"
import { isLocalStorageMode } from "@/lib/storage-mode"
import { WEEKDAY_NAMES } from "@/lib/subject-utils"

const R2_KEY_PREFIX = "r2/"

function requireEnv(name: string) {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function createR2Client() {
  return new S3Client({
    region: "auto",
    endpoint: requireEnv("R2_ENDPOINT"),
    credentials: {
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    },
  })
}

function getBucketName() {
  return requireEnv("R2_BUCKET_NAME")
}

function assertR2Enabled(operation: string) {
  if (isLocalStorageMode()) {
    console.info("[data-source]", {
      source: "r2",
      status: "blocked",
      operation,
      reason: "local-storage-mode",
    })
    throw new Error("R2 deshabilitado en modo local.")
  }
}

function sanitizePathSegment(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "archivo"
}

function getFileNameFromKey(objectKey: string) {
  const segments = objectKey.split("/")
  return segments[segments.length - 1] || objectKey
}

function normalizeMetadataValue(value: string | undefined) {
  const normalized = String(value || "")
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  return normalized.length > 0 ? normalized : undefined
}

function buildUploadMetadataHeaders(metadata: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [`x-amz-meta-${key}`, value])
  )
}

function isR2ObjectNotFoundError(error: unknown) {
  if (!error || typeof error !== "object") return false

  const maybeError = error as {
    name?: string
    code?: string
    Code?: string
    $metadata?: { httpStatusCode?: number }
  }

  return (
    maybeError.$metadata?.httpStatusCode === 404 ||
    maybeError.name === "NoSuchKey" ||
    maybeError.name === "NotFound" ||
    maybeError.code === "NoSuchKey" ||
    maybeError.code === "NotFound" ||
    maybeError.Code === "NoSuchKey" ||
    maybeError.Code === "NotFound"
  )
}

export function isR2ObjectKey(value: string) {
  return value.startsWith(R2_KEY_PREFIX)
}

export function buildR2ObjectKey(params: {
  subjectName: string
  weekNumber: number
  weekdayIndex: number
  fileName: string
}) {
  const subjectSegment = sanitizePathSegment(params.subjectName.replace(/\n/g, " "))
  const weekSegment = `semana-${params.weekNumber}`
  const daySegment = sanitizePathSegment(WEEKDAY_NAMES[params.weekdayIndex] || `dia-${params.weekdayIndex + 1}`)
  const fileSegment = sanitizePathSegment(params.fileName)
  return `${R2_KEY_PREFIX}${subjectSegment}/${weekSegment}/${daySegment}/${Date.now()}-${fileSegment}`
}

function normalizeUploadMetadata(input: Record<string, string> | undefined) {
  const metadata = Object.fromEntries(
    Object.entries(input ?? {}).flatMap(([key, value]) => {
      const normalizedValue = normalizeMetadataValue(value)
      return normalizedValue ? [[key, normalizedValue]] : []
    })
  )
  return Object.keys(metadata).length > 0 ? metadata : undefined
}

export async function uploadR2Object(params: {
  objectKey: string
  mimeType: string
  body: Buffer | Uint8Array | string
  metadata?: Record<string, string>
}) {
  assertR2Enabled("uploadR2Object")
  const client = createR2Client()
  const metadata = normalizeUploadMetadata(params.metadata)
  const bodySize = typeof params.body === "string" ? Buffer.byteLength(params.body) : params.body.byteLength

  if (bodySize === 0) {
    throw new Error(`Refusing to upload empty object to R2: ${params.objectKey}`)
  }

  await client.send(
    new PutObjectCommand({
      Bucket: getBucketName(),
      Key: params.objectKey,
      Body: params.body,
      ContentType: params.mimeType,
      Metadata: metadata,
    })
  )
}

export async function createR2UploadSession(params: {
  objectKey: string
  mimeType: string
  metadata?: Record<string, string>
}) {
  assertR2Enabled("createR2UploadSession")
  const client = createR2Client()
  const metadata = normalizeUploadMetadata(params.metadata)
  const command = new PutObjectCommand({
    Bucket: getBucketName(),
    Key: params.objectKey,
    ContentType: params.mimeType,
    Metadata: metadata,
  })
  const uploadUrl = await getSignedUrl(client, command, { expiresIn: 900 })

  return {
    uploadMode: "direct" as const,
    objectKey: params.objectKey,
    uploadUrl,
    fileName: getFileNameFromKey(params.objectKey),
    driveFileId: params.objectKey,
    mimeType: params.mimeType,
    headers: {
      "Content-Type": params.mimeType,
      ...buildUploadMetadataHeaders(metadata ?? {}),
    },
    metadata,
  }
}

export async function getR2ObjectMetadata(objectKey: string) {
  assertR2Enabled("getR2ObjectMetadata")
  const client = createR2Client()
  let response

  try {
    response = await client.send(
      new HeadObjectCommand({
        Bucket: getBucketName(),
        Key: objectKey,
      })
    )
  } catch (error) {
    if (isR2ObjectNotFoundError(error)) {
      throw new RemoteFileNotFoundError("r2", objectKey, "The R2 object does not exist.")
    }

    throw error
  }

  return {
    id: objectKey,
    name: response.Metadata?.["original-file-name"] || getFileNameFromKey(objectKey),
    mimeType: response.ContentType || "application/octet-stream",
    size: typeof response.ContentLength === "number" ? String(response.ContentLength) : undefined,
    metadata: response.Metadata ?? {},
    lastModified: response.LastModified?.toISOString() ?? null,
  }
}

export async function getR2ObjectMetadatas(objectKeys: string[]) {
  assertR2Enabled("getR2ObjectMetadatas")
  return Promise.all(objectKeys.map((objectKey) => getR2ObjectMetadata(objectKey)))
}

export async function listR2ObjectsByPrefix(prefix = R2_KEY_PREFIX) {
  assertR2Enabled("listR2ObjectsByPrefix")
  const client = createR2Client()
  const objects: Array<{
    key: string
    size: number
    lastModified: string | null
  }> = []

  let continuationToken: string | undefined
  do {
    const response = await client.send(
      new ListObjectsV2Command({
        Bucket: getBucketName(),
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    )

    for (const object of response.Contents ?? []) {
      if (!object.Key) continue
      objects.push({
        key: object.Key,
        size: typeof object.Size === "number" ? object.Size : 0,
        lastModified: object.LastModified?.toISOString() ?? null,
      })
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined
  } while (continuationToken)

  return objects
}

export async function downloadR2Object(objectKey: string) {
  assertR2Enabled("downloadR2Object")
  const client = createR2Client()
  let response

  try {
    response = await client.send(
      new GetObjectCommand({
        Bucket: getBucketName(),
        Key: objectKey,
      })
    )
  } catch (error) {
    if (isR2ObjectNotFoundError(error)) {
      throw new RemoteFileNotFoundError("r2", objectKey, "The R2 object does not exist.")
    }

    throw error
  }

  if (!response.Body) {
    throw new Error("R2 object download returned an empty body.")
  }

  const bytes = await response.Body.transformToByteArray()
  if (bytes.byteLength === 0) {
    throw new Error("R2 object download returned an empty payload.")
  }

  return {
    buffer: Buffer.from(bytes),
    mimeType: response.ContentType || "application/octet-stream",
  }
}

export async function deleteR2Object(objectKey: string) {
  assertR2Enabled("deleteR2Object")
  const client = createR2Client()
  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: getBucketName(),
        Key: objectKey,
      })
    )
    return { status: "deleted" as const }
  } catch (error) {
    if (isR2ObjectNotFoundError(error)) {
      return { status: "missing" as const }
    }

    throw error
  }
}
