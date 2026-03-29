const fs = require("fs")
const path = require("path")

const { neon } = require("@neondatabase/serverless")
const { PutObjectCommand, S3Client } = require("@aws-sdk/client-s3")

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
const DRIVE_API_BASE = "https://www.googleapis.com/drive/v3/files"
const R2_KEY_PREFIX = "r2/"
const WEEKDAY_NAMES = ["Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado", "Domingo"]
const SUBJECT_NAMES = {
  algebra: "Algebra 2",
  calculo2: "Calculo 2",
  calculo3: "Calculo 3",
  fisica: "Fisica 1",
  logica: "Logica y Computabilidad",
  probabilidad: "Probabilidad y Estadistica",
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return

  const content = fs.readFileSync(filePath, "utf8")
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const separatorIndex = trimmed.indexOf("=")
    if (separatorIndex <= 0) continue

    const key = trimmed.slice(0, separatorIndex).trim()
    let value = trimmed.slice(separatorIndex + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    if (!(key in process.env)) {
      process.env[key] = value
    }
  }
}

loadEnvFile(path.join(process.cwd(), ".env.local"))
loadEnvFile(path.join(process.cwd(), ".env"))

function requireEnv(name) {
  const value = process.env[name] && process.env[name].trim()
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return value
}

function sanitizePathSegment(value) {
  return (
    String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "archivo"
  )
}

function buildR2ObjectKey(params) {
  const subjectSegment = sanitizePathSegment(params.subjectName.replace(/\n/g, " "))
  const weekSegment = `semana-${params.weekNumber}`
  const daySegment = sanitizePathSegment(WEEKDAY_NAMES[params.weekdayIndex] || `dia-${params.weekdayIndex + 1}`)
  const fileSegment = sanitizePathSegment(params.fileName)
  return `${R2_KEY_PREFIX}${subjectSegment}/${weekSegment}/${daySegment}/${Date.now()}-${fileSegment}`
}

function normalizeDateKey(sessionDate) {
  if (sessionDate instanceof Date) {
    return `${sessionDate.getFullYear()}-${String(sessionDate.getMonth() + 1).padStart(2, "0")}-${String(sessionDate.getDate()).padStart(2, "0")}`
  }
  if (typeof sessionDate !== "string") return ""
  return sessionDate.includes("T") ? sessionDate.slice(0, 10) : sessionDate
}

function normalizeMetadataValue(value) {
  const normalized = String(value || "")
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()

  return normalized.length > 0 ? normalized : undefined
}

function normalizeMetadata(input) {
  return Object.fromEntries(
    Object.entries(input || {}).flatMap(([key, value]) => {
      const normalizedValue = normalizeMetadataValue(value)
      return normalizedValue ? [[key, normalizedValue]] : []
    })
  )
}

function guessFileExtension(mimeType) {
  const normalized = String(mimeType || "").toLowerCase()
  if (normalized.includes("ogg")) return "ogg"
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "mp3"
  if (normalized.includes("mp4") || normalized.includes("aac")) return "mp4"
  if (normalized.includes("wav")) return "wav"
  return "webm"
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

function getR2BucketName() {
  return requireEnv("R2_BUCKET_NAME")
}

async function getDriveAccessToken() {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: requireEnv("GOOGLE_OAUTH_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
      refresh_token: requireEnv("GOOGLE_DRIVE_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
  })

  const payload = await response.json()
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || "Failed to refresh Google access token")
  }

  return payload.access_token
}

async function driveRequest(url, accessToken) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    const payload = await response.text()
    throw new Error(payload || `Google Drive request failed with ${response.status}`)
  }

  return response
}

async function fetchDriveMetadata(fileId, accessToken) {
  const response = await driveRequest(
    `${DRIVE_API_BASE}/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size`,
    accessToken
  )
  return response.json()
}

async function downloadDriveFile(fileId, accessToken) {
  const response = await driveRequest(`${DRIVE_API_BASE}/${encodeURIComponent(fileId)}?alt=media`, accessToken)
  const arrayBuffer = await response.arrayBuffer()
  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType: response.headers.get("content-type") || "application/octet-stream",
  }
}

function getArgValue(prefix) {
  const arg = process.argv.find((item) => item.startsWith(`${prefix}=`))
  return arg ? arg.slice(prefix.length + 1) : ""
}

function getSubjectName(subjectId) {
  return SUBJECT_NAMES[subjectId] || subjectId
}

async function getCounts(sql) {
  const [row] = await sql`
    SELECT
      COUNT(*) FILTER (WHERE drive_mime_type LIKE 'audio/%')::int AS audio_total,
      COUNT(*) FILTER (WHERE drive_mime_type LIKE 'audio/%' AND drive_file_id LIKE 'r2/%')::int AS audio_r2_count,
      COUNT(*) FILTER (WHERE drive_mime_type LIKE 'audio/%' AND drive_file_id <> '' AND drive_file_id NOT LIKE 'r2/%')::int AS audio_drive_count
    FROM subject_day_entries
  `

  return row
}

async function getLegacyEntries(sql, filters) {
  const conditions = [
    "drive_mime_type LIKE 'audio/%'",
    "drive_file_id <> ''",
    "drive_file_id NOT LIKE 'r2/%'",
  ]

  if (filters.entryId) {
    conditions.push(`id = ${Number(filters.entryId)}`)
  }

  if (filters.subjectId) {
    conditions.push(`subject_id = '${String(filters.subjectId).replace(/'/g, "''")}'`)
  }

  const limitClause = filters.limit ? `LIMIT ${Number(filters.limit)}` : ""
  const query = `
    SELECT
      id,
      subject_id,
      week_number,
      session_date,
      weekday_index,
      order_index,
      drive_file_id,
      drive_file_name,
      drive_mime_type
    FROM subject_day_entries
    WHERE ${conditions.join(" AND ")}
    ORDER BY id ASC
    ${limitClause}
  `

  return sql(query)
}

async function updateEntryToR2(sql, entryId, nextFileId, nextFileName, nextMimeType) {
  await sql`
    UPDATE subject_day_entries
    SET
      drive_file_id = ${nextFileId},
      drive_file_name = ${nextFileName},
      drive_mime_type = ${nextMimeType},
      drive_web_view_link = '',
      updated_at = NOW()
    WHERE id = ${entryId}
  `
}

async function uploadBufferToR2(client, objectKey, mimeType, body, metadata) {
  await client.send(
    new PutObjectCommand({
      Bucket: getR2BucketName(),
      Key: objectKey,
      Body: body,
      ContentType: mimeType,
      Metadata: normalizeMetadata(metadata),
    })
  )
}

async function main() {
  const shouldMigrate = process.argv.includes("--migrate")
  const limit = Number.parseInt(getArgValue("--limit"), 10)
  const entryId = Number.parseInt(getArgValue("--entry"), 10)
  const subjectId = getArgValue("--subject")

  const sql = neon(requireEnv("DATABASE_URL"))
  const filters = {
    limit: Number.isInteger(limit) ? limit : null,
    entryId: Number.isInteger(entryId) ? entryId : null,
    subjectId: subjectId || null,
  }

  const beforeCounts = await getCounts(sql)
  console.log("[legacy-audio] counts-before", JSON.stringify(beforeCounts))

  const legacyEntries = await getLegacyEntries(sql, filters)
  console.log(`[legacy-audio] legacy-audio-entries=${legacyEntries.length}`)

  if (legacyEntries.length === 0) {
    console.log("[legacy-audio] no legacy Drive audio entries found")
    return
  }

  let accessToken
  try {
    accessToken = await getDriveAccessToken()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "Unknown Drive auth error")
    console.error("[legacy-audio] drive-auth-check-failed", message)
    console.error("[legacy-audio] reauthorize Google Drive temporarily, then rerun the migration")
    process.exitCode = 2
    return
  }

  try {
    const probe = legacyEntries[0]
    const metadata = await fetchDriveMetadata(probe.drive_file_id, accessToken)
    console.log("[legacy-audio] drive-read-check-ok", JSON.stringify({
      entryId: probe.id,
      driveFileId: probe.drive_file_id,
      driveName: metadata.name,
      driveMimeType: metadata.mimeType,
    }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "Unknown Drive read error")
    console.error("[legacy-audio] drive-read-check-failed", message)
    console.error("[legacy-audio] reauthorize Google Drive temporarily, then rerun the migration")
    process.exitCode = 2
    return
  }

  if (!shouldMigrate) {
    console.log("[legacy-audio] verification-only mode. Run `npm run audio:legacy:migrate` to migrate legacy entries to R2.")
    console.log(
      "[legacy-audio] sample",
      JSON.stringify(
        legacyEntries.slice(0, 10).map((entry) => ({
          id: entry.id,
          subject_id: entry.subject_id,
          session_date: normalizeDateKey(entry.session_date),
          drive_file_id: entry.drive_file_id,
          drive_file_name: entry.drive_file_name,
        }))
      )
    )
    return
  }

  const r2Client = createR2Client()
  const migrated = []
  const failed = []

  for (const entry of legacyEntries) {
    try {
      const normalizedSessionDate = normalizeDateKey(entry.session_date)
      const fallbackFileName = `${entry.subject_id}-${normalizedSessionDate}-${Number(entry.order_index) + 1}.${guessFileExtension(entry.drive_mime_type)}`
      const nextFileName = entry.drive_file_name || fallbackFileName
      const objectKey = buildR2ObjectKey({
        subjectName: getSubjectName(entry.subject_id),
        weekNumber: Number(entry.week_number),
        weekdayIndex: Number(entry.weekday_index),
        fileName: nextFileName,
      })

      const downloadedFile = await downloadDriveFile(entry.drive_file_id, accessToken)
      await uploadBufferToR2(r2Client, objectKey, downloadedFile.mimeType || entry.drive_mime_type, downloadedFile.buffer, {
        "subject-id": String(entry.subject_id),
        "subject-name": getSubjectName(entry.subject_id),
        "session-date": normalizedSessionDate,
        "week-number": String(entry.week_number),
        "weekday-index": String(entry.weekday_index),
        "original-file-name": nextFileName,
        "legacy-drive-file-id": String(entry.drive_file_id),
        "legacy-entry-id": String(entry.id),
      })

      await updateEntryToR2(sql, entry.id, objectKey, nextFileName, downloadedFile.mimeType || entry.drive_mime_type)
      migrated.push({ id: entry.id, from: entry.drive_file_id, to: objectKey })
      console.log(`[legacy-audio] migrated entry=${entry.id} -> ${objectKey}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error || "Unknown migration error")
      failed.push({ id: entry.id, drive_file_id: entry.drive_file_id, error: message })
      console.error(`[legacy-audio] failed entry=${entry.id} driveFileId=${entry.drive_file_id} error=${message}`)
    }
  }

  const afterCounts = await getCounts(sql)
  console.log("[legacy-audio] counts-after", JSON.stringify(afterCounts))
  console.log("[legacy-audio] summary", JSON.stringify({
    attempted: legacyEntries.length,
    migrated: migrated.length,
    failed: failed.length,
  }))

  if (failed.length > 0) {
    console.log("[legacy-audio] failed-entries", JSON.stringify(failed, null, 2))
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error("[legacy-audio] fatal", error)
  process.exit(1)
})
