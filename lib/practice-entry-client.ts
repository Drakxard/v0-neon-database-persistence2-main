"use client"

import { uploadBlobToStorage, type DriveUploadSessionResponse } from "@/lib/client-storage-upload"
import { requireOkJson } from "@/lib/client/api"

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
  pairId?: string | null
  pairRole?: "question" | "answer" | null
}

type PracticeTextEntryParams = PracticeEntryBaseParams & {
  transcriptText: string
  answerText?: string
}

export async function createPracticeAudioEntry<TEntry = unknown>({
  subjectId,
  subjectName,
  sessionDate,
  weekNumber,
  materialId,
  blob,
  mimeType,
  pairId,
  pairRole,
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
        pairId: pairId?.trim() || null,
        pairRole: pairRole ?? null,
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
