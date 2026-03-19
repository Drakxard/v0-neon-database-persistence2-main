import { NextResponse } from "next/server"

import { ensureSubjectAccess, requireAuthSession } from "@/lib/authz"
import { isR2ObjectKey, uploadR2Object } from "@/lib/r2"

export const runtime = "nodejs"

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

function parseMetadata(rawMetadata: FormDataEntryValue | null) {
  if (typeof rawMetadata !== "string" || rawMetadata.trim().length === 0) {
    return undefined
  }

  try {
    const parsed = JSON.parse(rawMetadata) as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, value]) =>
        typeof value === "string" && value.trim().length > 0 ? [[key, value]] : []
      )
    )
  } catch {
    throw new Error("Invalid metadata payload")
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const formData = await request.formData()
    const fileEntry = formData.get("file")
    const objectKey = String(formData.get("objectKey") || "").trim()
    const mimeType = String(formData.get("mimeType") || "").trim() || "application/octet-stream"
    const metadata = parseMetadata(formData.get("metadata"))

    if (!(fileEntry instanceof File)) {
      return badRequest("Missing file")
    }

    if (!objectKey || !isR2ObjectKey(objectKey)) {
      return badRequest("Invalid objectKey")
    }

    const metadataSubjectId = String(metadata?.["subject-id"] || "").trim()
    if (metadataSubjectId) {
      const forbidden = ensureSubjectAccess(auth.session!, metadataSubjectId)
      if (forbidden) return forbidden
    }

    const arrayBuffer = await fileEntry.arrayBuffer()
    await uploadR2Object({
      objectKey,
      mimeType,
      body: Buffer.from(arrayBuffer),
      metadata,
    })

    return NextResponse.json({
      driveFileId: objectKey,
      fileName: fileEntry.name,
      mimeType,
    })
  } catch (error) {
    console.error("POST /api/storage/r2-upload error:", error)
    const message = error instanceof Error ? error.message : "Failed to upload file to R2"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
