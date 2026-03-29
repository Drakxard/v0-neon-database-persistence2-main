"use client"

import { uploadBlobToStorage, type DriveUploadSessionResponse } from "@/lib/client-storage-upload"

type PracticeEntryBaseParams = {
  subjectId: string
  sessionDate: string
  weekNumber: number
  weekdayIndex: number
  materialId: number | null
}

type PracticeAudioEntryParams = PracticeEntryBaseParams & {
  subjectName: string
  blob: Blob
  mimeType?: string
}

type PracticeTextEntryParams = PracticeEntryBaseParams & {
  transcriptText: string
  answerText?: string
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

async function readResponsePayload(response: Response) {
  const contentType = response.headers.get("content-type") || ""

  if (contentType.includes("application/json")) {
    return response.json()
  }

  const text = await response.text()
  if (!text) return null

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function requireOkJson(response: Response, fallback: string) {
  const payload = await readResponsePayload(response)
  if (!response.ok) {
    throw new Error(getErrorMessage(payload, fallback))
  }

  return payload
}

export async function createPracticeAudioEntry<TEntry = unknown>({
  subjectId,
  subjectName,
  sessionDate,
  weekNumber,
  materialId,
  blob,
  mimeType,
}: PracticeAudioEntryParams) {
  const normalizedMimeType = mimeType || blob.type || "audio/webm"
  const audioFile = new File([blob], `${subjectId}-${sessionDate}.webm`, {
    type: normalizedMimeType,
  })

  const sessionResponse = await fetch("/api/subject-day-entries/upload-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subjectId,
      subjectName,
      sessionDate,
      weekNumber,
      materialId,
      mimeType: audioFile.type || normalizedMimeType,
    }),
  })
  const sessionPayload = (await requireOkJson(
    sessionResponse,
    "No se pudo preparar la subida del audio."
  )) as DriveUploadSessionResponse

  const { driveFileId } = await uploadBlobToStorage(sessionPayload, audioFile)

  return requireOkJson(
    await fetch("/api/subject-day-entries/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subjectId,
        sessionDate,
        weekNumber,
        materialId,
        driveFileId,
        fileName: audioFile.name,
      }),
    }),
    "No se pudo confirmar el audio."
  ) as Promise<TEntry>
}

export async function createPracticeTextEntry<TEntry = unknown>({
  subjectId,
  sessionDate,
  weekNumber,
  weekdayIndex,
  materialId,
  transcriptText,
  answerText = "",
}: PracticeTextEntryParams) {
  return requireOkJson(
    await fetch("/api/subject-day-entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subjectId,
        sessionDate,
        weekNumber,
        weekdayIndex,
        materialId,
        transcriptText,
        answerText,
      }),
    }),
    "No se pudo crear la duda."
  ) as Promise<TEntry>
}
