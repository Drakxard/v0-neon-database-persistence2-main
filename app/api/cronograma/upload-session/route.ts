import { NextResponse } from "next/server"

import { requireAuthSession } from "@/lib/authz"
import {
  buildCronogramaObjectKey,
  CRONOGRAMA_RESOURCE_TYPE,
  normalizeCronogramaEmail,
  normalizeUploadedPdfFileName,
} from "@/lib/cronograma"

export const runtime = "nodejs"

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const payload = await request.json()
    const fileName = normalizeUploadedPdfFileName(String(payload?.fileName || ""))
    const mimeType = String(payload?.mimeType || "").trim() || "application/pdf"
    if (!fileName) {
      return badRequest("Missing fileName")
    }
    if (mimeType !== "application/pdf") {
      return badRequest("Only PDF files are allowed")
    }

    const email = normalizeCronogramaEmail(auth.session!.email)
    const objectKey = buildCronogramaObjectKey({
      email,
      fileName,
    })
    const metadata = {
      "owner-email": email,
      "original-file-name": fileName,
      "resource-type": CRONOGRAMA_RESOURCE_TYPE,
    }

    return NextResponse.json({
      uploadMode: "server",
      objectKey,
      metadata,
      mimeType,
      fileName,
      driveFileId: objectKey,
    })
  } catch (error) {
    console.error("POST /api/cronograma/upload-session error:", error)
    const message = error instanceof Error ? error.message : "Failed to create cronograma upload session"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
