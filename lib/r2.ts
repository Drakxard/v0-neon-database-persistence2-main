import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

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
  const normalized = String(value || "").trim()
  return normalized.length > 0 ? normalized : undefined
}

function buildUploadMetadataHeaders(metadata: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [`x-amz-meta-${key}`, value])
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

export async function createR2UploadSession(params: {
  objectKey: string
  mimeType: string
  metadata?: Record<string, string>
  expiresInSeconds?: number
}) {
  const client = createR2Client()
  const metadata = Object.fromEntries(
    Object.entries(params.metadata ?? {}).flatMap(([key, value]) => {
      const normalizedValue = normalizeMetadataValue(value)
      return normalizedValue ? [[key, normalizedValue]] : []
    })
  )
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: getBucketName(),
      Key: params.objectKey,
      ContentType: params.mimeType,
      Metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    }),
    { expiresIn: params.expiresInSeconds ?? 900 }
  )

  return {
    uploadUrl,
    fileName: getFileNameFromKey(params.objectKey),
    driveFileId: params.objectKey,
    headers: {
      "Content-Type": params.mimeType,
      ...buildUploadMetadataHeaders(metadata),
    },
  }
}

export async function getR2ObjectMetadata(objectKey: string) {
  const client = createR2Client()
  const response = await client.send(
    new HeadObjectCommand({
      Bucket: getBucketName(),
      Key: objectKey,
    })
  )

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
  return Promise.all(objectKeys.map((objectKey) => getR2ObjectMetadata(objectKey)))
}

export async function listR2ObjectsByPrefix(prefix = R2_KEY_PREFIX) {
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
  const client = createR2Client()
  const response = await client.send(
    new GetObjectCommand({
      Bucket: getBucketName(),
      Key: objectKey,
    })
  )

  if (!response.Body) {
    throw new Error("R2 object download returned an empty body.")
  }

  const bytes = await response.Body.transformToByteArray()
  return {
    buffer: Buffer.from(bytes),
    mimeType: response.ContentType || "application/octet-stream",
  }
}

export async function deleteR2Object(objectKey: string) {
  const client = createR2Client()
  await client.send(
    new DeleteObjectCommand({
      Bucket: getBucketName(),
      Key: objectKey,
    })
  )
}
