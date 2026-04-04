import { neon } from "@neondatabase/serverless"
import { NextResponse } from "next/server"

import { ensureSubjectAccess, requireAuthSession } from "@/lib/authz"
import { parseRequiredString } from "@/lib/server/request-parsing"

export const runtime = "nodejs"

const sql = neon(process.env.DATABASE_URL!)

type ShortcutKey = "e_fich" | "figma"

type ShortcutRow = {
  subject_id: string
  shortcut_key: ShortcutKey
  url: string
}

function isMissingSubjectShortcutsTable(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "42P01"
  )
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 })
}

function normalizeShortcutResponse(subjectId: string, rows: ShortcutRow[]) {
  const response = {
    subjectId,
    eFich: null as string | null,
    figma: null as string | null,
  }

  for (const row of rows) {
    if (row.shortcut_key === "e_fich") {
      response.eFich = row.url
    } else if (row.shortcut_key === "figma") {
      response.figma = row.url
    }
  }

  return response
}

async function selectSubjectShortcuts(subjectId: string) {
  return await sql`
    SELECT subject_id, shortcut_key, url
    FROM subject_shortcuts
    WHERE subject_id = ${subjectId}
    ORDER BY shortcut_key ASC
  ` as ShortcutRow[]
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const subjectId = parseRequiredString(searchParams.get("subjectId"))

  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    if (!subjectId) {
      return badRequest("Missing subjectId")
    }

    const forbidden = ensureSubjectAccess(auth.session!, subjectId)
    if (forbidden) return forbidden

    const rows = await selectSubjectShortcuts(subjectId)
    return NextResponse.json(normalizeShortcutResponse(subjectId, rows))
  } catch (error) {
    console.error("GET /api/subject-shortcuts error:", error)
    if (isMissingSubjectShortcutsTable(error)) {
      return NextResponse.json(normalizeShortcutResponse(subjectId, []))
    }
    return NextResponse.json({ error: "Failed to fetch subject shortcuts" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const body = await request.json()
    const subjectId = parseRequiredString(body?.subjectId)
    const shortcutKey = body?.shortcutKey === "e_fich" || body?.shortcutKey === "figma" ? body.shortcutKey : null
    const url = parseRequiredString(body?.url)

    if (!subjectId) {
      return badRequest("Missing subjectId")
    }

    if (!shortcutKey) {
      return badRequest("Invalid shortcutKey")
    }

    if (!url) {
      return badRequest("Missing url")
    }

    const forbidden = ensureSubjectAccess(auth.session!, subjectId)
    if (forbidden) return forbidden

    let normalizedUrl = url
    try {
      normalizedUrl = new URL(url).toString()
    } catch {
      return badRequest("Invalid url")
    }

    await sql`
      INSERT INTO subject_shortcuts (subject_id, shortcut_key, url)
      VALUES (${subjectId}, ${shortcutKey}, ${normalizedUrl})
      ON CONFLICT (subject_id, shortcut_key)
      DO UPDATE SET
        url = EXCLUDED.url,
        updated_at = NOW()
    `

    const rows = await selectSubjectShortcuts(subjectId)
    return NextResponse.json(normalizeShortcutResponse(subjectId, rows))
  } catch (error) {
    console.error("PUT /api/subject-shortcuts error:", error)
    if (isMissingSubjectShortcutsTable(error)) {
      return NextResponse.json(
        { error: "Falta crear la tabla subject_shortcuts. Ejecuta scripts/014-create-subject-shortcuts.sql en Neon." },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: "Failed to save subject shortcut" }, { status: 500 })
  }
}
