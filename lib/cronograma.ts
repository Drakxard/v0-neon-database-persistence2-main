import type { CronogramaRecord } from "@/lib/study-types"

export const CRONOGRAMA_RESOURCE_TYPE = "cronograma"

export type UserCronogramaRow = {
  email: string
  file_name: string
  drive_file_id: string
  drive_mime_type: string
  created_at: string
  updated_at: string
}

export function normalizeCronogramaEmail(email: string) {
  return email.trim().toLowerCase()
}

function sanitizeCronogramaPathSegment(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase() || "archivo"
}

export function normalizeUploadedPdfFileName(fileName: string) {
  const trimmed = fileName.trim()
  if (!trimmed) return ""
  return trimmed.toLowerCase().endsWith(".pdf") ? trimmed : `${trimmed}.pdf`
}

export function buildCronogramaObjectKey(params: { email: string; fileName: string }) {
  const emailSegment = sanitizeCronogramaPathSegment(normalizeCronogramaEmail(params.email))
  const fileSegment = sanitizeCronogramaPathSegment(params.fileName)
  return `r2/cronograma/${emailSegment}/${Date.now()}-${fileSegment}`
}

export function looksLikePdf(buffer: Buffer) {
  if (buffer.byteLength === 0) return false
  const headerWindow = buffer.subarray(0, Math.min(buffer.byteLength, 1024)).toString("latin1")
  return headerWindow.includes("%PDF-")
}

export function isMissingCronogramaTable(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "42P01")
}

export function normalizeCronogramaRecord(row: UserCronogramaRow | null): CronogramaRecord | null {
  if (!row) return null

  return {
    fileName: row.file_name,
    driveFileId: row.drive_file_id,
    driveMimeType: row.drive_mime_type,
    updatedAt: row.updated_at,
  }
}
