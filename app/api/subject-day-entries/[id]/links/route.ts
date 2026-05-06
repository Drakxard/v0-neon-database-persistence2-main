import { neon } from "@neondatabase/serverless"
import { NextResponse } from "next/server"
import { ensureSubjectAccess, requireAuthSession } from "@/lib/authz"
import { findLocalEntryById, readEntryManifest, saveEntryManifest } from "@/lib/local-r2-manifests"
import { isLocalStorageMode } from "@/lib/storage-mode"

export const runtime = "nodejs"

const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null

function isMissingSubjectDayEntriesTable(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "42P01"
  )
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const { id } = await context.params
    const entryId = Number.parseInt(id, 10)
    if (!Number.isInteger(entryId)) {
      return NextResponse.json({ error: "Invalid entry id" }, { status: 400 })
    }

    const body = await request.json()
    const label = typeof body.label === "string" ? body.label.trim() : ""
    const url = typeof body.url === "string" ? body.url.trim() : ""

    if (!label || !url) {
      return NextResponse.json({ error: "Missing label or url" }, { status: 400 })
    }

    let normalizedUrl = url
    try {
      normalizedUrl = new URL(url).toString()
    } catch {
      return NextResponse.json({ error: "Invalid url" }, { status: 400 })
    }

    if (isLocalStorageMode()) {
      const entry = await findLocalEntryById(entryId)
      if (!entry) {
        return NextResponse.json({ error: "Entry not found" }, { status: 404 })
      }

      const forbidden = ensureSubjectAccess(auth.session!, entry.subject_id)
      if (forbidden) return forbidden

      const manifest = await readEntryManifest(entry.subject_id, entry.week_number)
      const nextLink = {
        id: Number(`${Date.now()}${Math.floor(Math.random() * 100).toString().padStart(2, "0")}`),
        label,
        url: normalizedUrl,
      }
      const updatedEntries = manifest.entries.map((candidate) =>
        candidate.id === entryId
          ? {
              ...candidate,
              updated_at: new Date().toISOString(),
              external_links: [...candidate.external_links, nextLink],
            }
          : candidate
      )
      await saveEntryManifest(entry.subject_id, entry.week_number, updatedEntries)
      return NextResponse.json(nextLink)
    }

    const existingEntry = await sql`
      SELECT id, subject_id
      FROM subject_day_entries
      WHERE id = ${entryId}
    `

    if (!existingEntry[0]) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 })
    }

    const forbidden = ensureSubjectAccess(auth.session!, String(existingEntry[0].subject_id || ""))
    if (forbidden) return forbidden

    const [orderRow] = await sql`
      SELECT COALESCE(MAX(order_index), -1) AS max_order
      FROM subject_day_entry_links
      WHERE entry_id = ${entryId}
    `
    const nextOrderIndex = Number(orderRow?.max_order ?? -1) + 1

    const rows = await sql`
      INSERT INTO subject_day_entry_links (entry_id, label, url, order_index)
      VALUES (${entryId}, ${label}, ${normalizedUrl}, ${nextOrderIndex})
      RETURNING id, entry_id, label, url, order_index, created_at, updated_at
    `

    return NextResponse.json(rows[0])
  } catch (error) {
    console.error("POST /api/subject-day-entries/[id]/links error:", error)
    if (isMissingSubjectDayEntriesTable(error)) {
      return NextResponse.json(
        { error: "Falta crear la tabla subject_day_entries. Ejecuta scripts/005-create-subject-day-entries.sql y scripts/006-add-subject-day-entry-metadata.sql en Neon." },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: "Failed to create entry link" }, { status: 500 })
  }
}
