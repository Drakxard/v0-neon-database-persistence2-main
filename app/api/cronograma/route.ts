import { getLegacyDatabase } from "@/lib/db"
import { requireSql } from "@/lib/db"
import { NextResponse } from "next/server"

import { requireAuthSession } from "@/lib/authz"
import {
  isMissingCronogramaTable,
  normalizeCronogramaEmail,
  normalizeCronogramaRecord,
  type UserCronogramaRow,
} from "@/lib/cronograma"
import { readCronogramaManifest } from "@/lib/local-r2-manifests"
import { isRemoteFileNotFoundError } from "@/lib/remote-file-errors"
import { getR2ObjectMetadata } from "@/lib/r2"
import { isLocalStorageMode } from "@/lib/storage-mode"

export const runtime = "nodejs"

const sql = getLegacyDatabase()

export async function GET() {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    if (isLocalStorageMode()) {
      return NextResponse.json(await readCronogramaManifest())
    }

    const email = normalizeCronogramaEmail(auth.session!.email)
    const rows = await requireSql(sql)`
      SELECT email, file_name, drive_file_id, drive_mime_type, created_at, updated_at
      FROM user_cronograma_pdfs
      WHERE email = ${email}
      LIMIT 1
    ` as UserCronogramaRow[]

    const row = rows[0] ?? null
    if (!row) {
      return NextResponse.json(null)
    }

    try {
      await getR2ObjectMetadata(row.drive_file_id)
    } catch (error) {
      if (isRemoteFileNotFoundError(error)) {
        await requireSql(sql)`
          DELETE FROM user_cronograma_pdfs
          WHERE email = ${email}
        `
        return NextResponse.json(null)
      }

      throw error
    }

    return NextResponse.json(normalizeCronogramaRecord(row))
  } catch (error) {
    console.error("GET /api/cronograma error:", error)
    if (isMissingCronogramaTable(error)) {
      return NextResponse.json(
        { error: "Falta crear la tabla user_cronograma_pdfs. Ejecuta scripts/028-create-user-cronograma-pdfs.sql en Neon." },
        { status: 503 }
      )
    }

    const message = error instanceof Error ? error.message : "Failed to load cronograma"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
