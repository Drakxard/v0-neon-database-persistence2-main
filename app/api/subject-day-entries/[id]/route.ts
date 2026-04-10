import { neon, Pool, type PoolClient } from "@neondatabase/serverless"
import { NextResponse } from "next/server"

import { deleteDriveFile } from "@/lib/google-drive"
import { deleteR2Object, isR2ObjectKey } from "@/lib/r2"
import { ensureSubjectAccess, requireAuthSession } from "@/lib/authz"

export const runtime = "nodejs"

const sql = neon(process.env.DATABASE_URL!)
const globalForPool = globalThis as typeof globalThis & { __subjectDayEntriesPool?: Pool }
const pool =
  globalForPool.__subjectDayEntriesPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL!,
  })

if (process.env.NODE_ENV !== "production") {
  globalForPool.__subjectDayEntriesPool = pool
}

type EntryRow = {
  id: number
  subject_day_material_id: number | null
  subject_id: string
  week_number: number
  session_date: string
  weekday_index: number
  order_index: number
  transcript_text: string
  drive_file_id: string
  drive_file_name: string
  drive_mime_type: string
  drive_web_view_link: string
  answer_text: string | null
  custom_title: string | null
  practice_state: "erre" | null
  pair_id: string | null
  pair_role: "question" | "answer" | null
  is_featured: boolean
  created_at: string
  updated_at: string
}

type PairStateRow = {
  id: number
  pair_id: string | null
  pair_role: "question" | "answer" | null
}

class InvalidAudioPairStateError extends Error {}

function isMissingSubjectDayEntriesTable(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "42P01"
  )
}

function isMissingColumn(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "42703"
    )
}

function isMissingPairColumn(error: unknown) {
  return isMissingColumn(error)
}

function isUniqueViolation(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "23505"
  )
}

function getDisplayTitle(entry: Pick<EntryRow, "custom_title" | "order_index">) {
  const customTitle = entry.custom_title?.trim()
  return customTitle && customTitle.length > 0 ? customTitle : `Duda ${entry.order_index + 1}`
}

function normalizeSessionDateKey(sessionDate: string | Date) {
  if (sessionDate instanceof Date) {
    return `${sessionDate.getFullYear()}-${String(sessionDate.getMonth() + 1).padStart(2, "0")}-${String(sessionDate.getDate()).padStart(2, "0")}`
  }

  return sessionDate.includes("T") ? sessionDate.slice(0, 10) : sessionDate
}

function getDatabaseHost() {
  try {
    const databaseUrl = process.env.DATABASE_URL
    if (!databaseUrl) return "unknown"
    return new URL(databaseUrl).host
  } catch {
    return "invalid"
  }
}

function getMissingMetadataColumnResponse(body: Record<string, unknown>) {
  if ("customTitle" in body) {
    return NextResponse.json(
      {
        error:
          "No se puede guardar el nombre de la duda porque falta aplicar scripts/006-add-subject-day-entry-metadata.sql en Neon (columna custom_title).",
        code: "MISSING_CUSTOM_TITLE_COLUMN",
      },
      { status: 409 }
    )
  }

  if ("practiceState" in body) {
    return NextResponse.json(
      {
        error:
          "No se puede guardar el estado de practica porque falta aplicar scripts/006-add-subject-day-entry-metadata.sql en Neon (columna practice_state).",
        code: "MISSING_PRACTICE_STATE_COLUMN",
      },
      { status: 409 }
    )
  }

  if ("isFeatured" in body) {
    return NextResponse.json(
      {
        error:
          "No se puede guardar el destacado porque faltan las migraciones de metadata de subject_day_entries en Neon (scripts/006 y/o 007).",
        code: "MISSING_ENTRY_METADATA_COLUMNS",
      },
      { status: 409 }
    )
  }

  return NextResponse.json(
    {
      error: "Falta ejecutar scripts/006-add-subject-day-entry-metadata.sql en Neon para usar esta funcion.",
      code: "MISSING_ENTRY_METADATA_COLUMNS",
    },
    { status: 409 }
  )
}

function getInvalidAudioPairStateResponse(
  message = "La dupla tiene metadata inconsistente y no se puede invertir hasta corregirla."
) {
  return NextResponse.json(
    {
      error: message,
      code: "INVALID_AUDIO_PAIR_STATE",
    },
    { status: 409 }
  )
}

function getOppositePairRole(role: "question" | "answer") {
  return role === "question" ? "answer" : "question"
}

async function fetchEntryByIdWithClient(client: PoolClient, entryId: number) {
  const result = await client.query(
    `
      SELECT id, subject_day_material_id, subject_id, week_number, session_date, weekday_index, order_index, transcript_text, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, answer_text, custom_title, practice_state, pair_id, pair_role, is_featured, created_at, updated_at
      FROM subject_day_entries
      WHERE id = $1
      LIMIT 1
    `,
    [entryId]
  )

  return (result.rows[0] ?? null) as EntryRow | null
}

async function swapCompleteAudioPairRoleInTransaction(params: {
  entryId: number
  pairId: string
  pairRole: "question" | "answer"
}) {
  const client = await pool.connect()
  let began = false

  try {
    await client.query("BEGIN")
    began = true

    const pairResult = await client.query(
      `
        SELECT id, pair_id, pair_role
        FROM subject_day_entries
        WHERE pair_id = $1
        ORDER BY id ASC
        FOR UPDATE
      `,
      [params.pairId]
    )
    const pairRows = pairResult.rows as PairStateRow[]

    if (pairRows.length !== 2) {
      throw new InvalidAudioPairStateError("La dupla ya no tiene exactamente dos audios y no se puede invertir en forma segura.")
    }

    const target = pairRows.find((row) => row.id === params.entryId) ?? null
    const sibling = pairRows.find((row) => row.id !== params.entryId) ?? null

    if (!target?.pair_id || !target.pair_role || !sibling?.pair_role) {
      throw new InvalidAudioPairStateError()
    }

    if (pairRows.some((row) => row.pair_id !== params.pairId || !row.pair_role)) {
      throw new InvalidAudioPairStateError()
    }

    const distinctRoles = new Set(pairRows.map((row) => row.pair_role))
    if (distinctRoles.size !== 2) {
      throw new InvalidAudioPairStateError("La dupla completa tiene roles duplicados o incompletos y no se puede invertir automaticamente.")
    }

    if (target.pair_role === params.pairRole) {
      const unchangedEntry = await fetchEntryByIdWithClient(client, params.entryId)
      if (!unchangedEntry) {
        throw new InvalidAudioPairStateError()
      }
      await client.query("COMMIT")
      began = false
      return unchangedEntry
    }

    if (target.pair_role !== getOppositePairRole(params.pairRole) || sibling.pair_role !== params.pairRole) {
      throw new InvalidAudioPairStateError("La dupla completa no quedo en un estado intercambiable.")
    }

    const temporaryPairId = `${params.pairId}::swap::${params.entryId}::${Date.now()}`

    const movedTarget = await client.query(
      `
        UPDATE subject_day_entries
        SET pair_id = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING id
      `,
      [temporaryPairId, params.entryId]
    )
    if (movedTarget.rowCount !== 1) {
      throw new InvalidAudioPairStateError("No se pudo aislar temporalmente el audio a intercambiar.")
    }

    const updatedSibling = await client.query(
      `
        UPDATE subject_day_entries
        SET pair_role = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING id
      `,
      [target.pair_role, sibling.id]
    )
    if (updatedSibling.rowCount !== 1) {
      throw new InvalidAudioPairStateError("No se pudo actualizar el audio hermano durante el intercambio.")
    }

    const restoredTarget = await client.query(
      `
        UPDATE subject_day_entries
        SET pair_id = $1, pair_role = $2, updated_at = NOW()
        WHERE id = $3
        RETURNING id, subject_day_material_id, subject_id, week_number, session_date, weekday_index, order_index, transcript_text, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, answer_text, custom_title, practice_state, pair_id, pair_role, is_featured, created_at, updated_at
      `,
      [params.pairId, params.pairRole, params.entryId]
    )
    const restoredEntry = (restoredTarget.rows[0] ?? null) as EntryRow | null
    if (!restoredEntry) {
      throw new InvalidAudioPairStateError("No se pudo restaurar el audio dentro de la dupla original.")
    }

    const finalPairResult = await client.query(
      `
        SELECT id, pair_id, pair_role
        FROM subject_day_entries
        WHERE pair_id = $1
        ORDER BY id ASC
        FOR UPDATE
      `,
      [params.pairId]
    )
    const finalPairRows = finalPairResult.rows as PairStateRow[]
    if (
      finalPairRows.length !== 2 ||
      finalPairRows.some((row) => row.pair_id !== params.pairId || !row.pair_role) ||
      new Set(finalPairRows.map((row) => row.pair_role)).size !== 2
    ) {
      throw new InvalidAudioPairStateError("La dupla quedo inconsistente despues del intercambio y se cancelo el cambio.")
    }

    await client.query("COMMIT")
    began = false
    return restoredEntry
  } catch (error) {
    if (began) {
      try {
        await client.query("ROLLBACK")
      } catch (rollbackError) {
        console.error("Failed to rollback audio pair swap transaction:", rollbackError)
      }
    }
    throw error
  } finally {
    client.release()
  }
}

async function withLinks(row: EntryRow | null) {
  if (!row) return null

  let links: { id: number; label: string; url: string }[]
  try {
    links = await sql`
      SELECT id, label, url
      FROM subject_day_entry_links
      WHERE entry_id = ${row.id}
      ORDER BY order_index ASC, id ASC
    ` as { id: number; label: string; url: string }[]
  } catch (error) {
    if (isMissingSubjectDayEntriesTable(error)) {
      links = []
    } else {
      throw error
    }
  }

  return {
    ...row,
    session_date: normalizeSessionDateKey(row.session_date),
    display_title: getDisplayTitle(row),
    external_links: links,
  }
}

function buildEntryResponse(row: EntryRow, links: { id: number; label: string; url: string }[] = []) {
  return {
    ...row,
    session_date: normalizeSessionDateKey(row.session_date),
    display_title: getDisplayTitle(row),
    external_links: links,
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const { id } = await context.params
    const entryId = Number.parseInt(id, 10)
    if (!Number.isInteger(entryId)) {
      return NextResponse.json({ error: "Invalid entry id" }, { status: 400 })
    }

    const scopeRows = await sql`
      SELECT subject_id
      FROM subject_day_entries
      WHERE id = ${entryId}
      LIMIT 1
    ` as Array<{ subject_id: string }>
    if (!scopeRows[0]) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 })
    }

    const forbidden = ensureSubjectAccess(auth.session!, scopeRows[0].subject_id)
    if (forbidden) return forbidden

    const body = await request.json()
    const answerText = typeof body.answerText === "string" ? body.answerText.trim() : null
    const transcriptText = typeof body.transcriptText === "string" ? body.transcriptText.trim() : null
    const customTitle = typeof body.customTitle === "string" ? body.customTitle.trim() : null
    const practiceState =
      body.practiceState === "erre" ? "erre" : body.practiceState === null ? null : undefined
    const isFeatured = typeof body.isFeatured === "boolean" ? body.isFeatured : undefined
    const featuredScope = body.featuredScope === "subject_week" ? "subject_week" : "entry_scope"
    const pairRole = body.pairRole === "question" || body.pairRole === "answer" ? body.pairRole : undefined
    const targetMaterialId =
      typeof body.targetMaterialId === "number" && Number.isInteger(body.targetMaterialId)
        ? body.targetMaterialId
        : undefined

    let rows: EntryRow[]
    try {
      if (pairRole !== undefined) {
        const pairScopeRows = await sql`
          SELECT id, pair_id, pair_role
          FROM subject_day_entries
          WHERE id = ${entryId}
          LIMIT 1
        ` as Array<{ id: number; pair_id: string | null; pair_role: "question" | "answer" | null }>

        const pairScope = pairScopeRows[0]
        if (!pairScope?.pair_id) {
          return NextResponse.json({ error: "Solo se puede cambiar el sentido dentro de una dupla." }, { status: 400 })
        }
        if (!pairScope.pair_role) {
          return getInvalidAudioPairStateResponse()
        }

        const pairRows = await sql`
          SELECT id, pair_id, pair_role
          FROM subject_day_entries
          WHERE pair_id = ${pairScope.pair_id}
          ORDER BY id ASC
        ` as Array<{ id: number; pair_id: string | null; pair_role: "question" | "answer" | null }>

        const targetPairRow = pairRows.find((row) => row.id === entryId) ?? null
        if (!targetPairRow?.pair_id || !targetPairRow.pair_role) {
          return getInvalidAudioPairStateResponse()
        }
        if (pairRows.length === 0 || pairRows.length > 2) {
          return getInvalidAudioPairStateResponse("La dupla tiene mas de dos audios activos y no se puede invertir en forma segura.")
        }
        if (pairRows.some((row) => !row.pair_role)) {
          return getInvalidAudioPairStateResponse()
        }

        const siblingRows = pairRows.filter((row) => row.id !== entryId)
        if (siblingRows.length > 1) {
          return getInvalidAudioPairStateResponse("La dupla tiene mas de un audio hermano y no se puede invertir en forma segura.")
        }

        const distinctRoles = new Set(pairRows.map((row) => row.pair_role))
        const isCompletePair = pairRows.length === 2

        if (isCompletePair && distinctRoles.size !== 2) {
          return getInvalidAudioPairStateResponse("La dupla tiene roles duplicados o incompletos y no se puede invertir automaticamente.")
        }

        if (targetPairRow.pair_role === pairRole) {
          rows = await sql`
            SELECT id, subject_day_material_id, subject_id, week_number, session_date, weekday_index, order_index, transcript_text, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, answer_text, custom_title, practice_state, pair_id, pair_role, is_featured, created_at, updated_at
            FROM subject_day_entries
            WHERE id = ${entryId}
          ` as EntryRow[]
        } else {
          if (isCompletePair) {
            const swappedEntry = await swapCompleteAudioPairRoleInTransaction({
              entryId,
              pairId: pairScope.pair_id,
              pairRole,
            })
            rows = [swappedEntry]
          } else {
            rows = await sql`
              UPDATE subject_day_entries
              SET pair_role = ${pairRole}, updated_at = NOW()
              WHERE id = ${entryId}
              RETURNING id, subject_day_material_id, subject_id, week_number, session_date, weekday_index, order_index, transcript_text, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, answer_text, custom_title, practice_state, pair_id, pair_role, is_featured, created_at, updated_at
            ` as EntryRow[]
          }

          rows = rows.filter((row) => row.id === entryId)
        }
      } else if (targetMaterialId !== undefined) {
        const targetMaterialRows = await sql`
          SELECT id, subject_id, week_number, session_date, weekday_index
          FROM subject_day_materials
          WHERE id = ${targetMaterialId}
          LIMIT 1
        ` as Array<{
          id: number
          subject_id: string
          week_number: number
          session_date: string
          weekday_index: number
        }>

        const targetMaterial = targetMaterialRows[0]
        if (!targetMaterial) {
          return NextResponse.json({ error: "No se encontro el PDF de destino." }, { status: 404 })
        }

        if (targetMaterial.subject_id !== scopeRows[0].subject_id) {
          return NextResponse.json(
            { error: "Solo se puede mover la duda a un PDF de la misma materia." },
            { status: 400 }
          )
        }

        rows = await sql`
          UPDATE subject_day_entries
          SET
            subject_day_material_id = ${targetMaterial.id},
            subject_id = ${targetMaterial.subject_id},
            week_number = ${targetMaterial.week_number},
            session_date = ${targetMaterial.session_date},
            weekday_index = ${targetMaterial.weekday_index},
            updated_at = NOW()
          WHERE id = ${entryId}
          RETURNING id, subject_day_material_id, subject_id, week_number, session_date, weekday_index, order_index, transcript_text, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, answer_text, custom_title, practice_state, pair_id, pair_role, is_featured, created_at, updated_at
        ` as EntryRow[]
      } else {
        rows = await sql`
        WITH entry_scope AS (
          SELECT subject_id, week_number, session_date, subject_day_material_id
          FROM subject_day_entries
          WHERE id = ${entryId}
        ),
        cleared AS (
          UPDATE subject_day_entries
          SET is_featured = FALSE
          WHERE ${isFeatured === true}
            AND (
              (
                ${featuredScope === "subject_week"} = TRUE
                AND (subject_id, week_number) IN (
                  SELECT subject_id, week_number
                  FROM entry_scope
                )
              )
              OR (
                ${featuredScope !== "subject_week"} = TRUE
                AND (SELECT subject_day_material_id FROM entry_scope LIMIT 1) IS NULL
                AND (subject_id, week_number) IN (
                  SELECT subject_id, week_number
                  FROM entry_scope
                )
                AND subject_day_material_id IS NULL
              )
              OR (
                (subject_id, week_number, session_date) IN (
                  SELECT subject_id, week_number, session_date
                  FROM entry_scope
                )
                AND subject_day_material_id = (SELECT subject_day_material_id FROM entry_scope LIMIT 1)
              )
            )
          RETURNING id
        )
        UPDATE subject_day_entries
        SET
          transcript_text = CASE WHEN ${"transcriptText" in body} THEN ${transcriptText || ""} ELSE transcript_text END,
          answer_text = CASE WHEN ${"answerText" in body} THEN ${answerText} ELSE answer_text END,
          custom_title = CASE WHEN ${"customTitle" in body} THEN ${customTitle} ELSE custom_title END,
          practice_state = CASE WHEN ${practiceState !== undefined} THEN ${practiceState ?? null} ELSE practice_state END,
          is_featured = CASE WHEN ${isFeatured !== undefined} THEN ${isFeatured} ELSE is_featured END,
          updated_at = NOW()
        WHERE id = ${entryId}
        RETURNING id, subject_day_material_id, subject_id, week_number, session_date, weekday_index, order_index, transcript_text, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, answer_text, custom_title, practice_state, pair_id, pair_role, is_featured, created_at, updated_at
        ` as EntryRow[]
      }
    } catch (error) {
      const isTryingNewFields = "customTitle" in body || practiceState !== undefined || isFeatured !== undefined
      if (isMissingColumn(error) && isTryingNewFields) {
        return getMissingMetadataColumnResponse(body as Record<string, unknown>)
      }

      if (isMissingPairColumn(error) && pairRole !== undefined) {
        return NextResponse.json(
          {
            error:
              "No se puede cambiar el sentido de la dupla porque faltan las columnas de audio pairs en Neon (scripts/016).",
            code: "MISSING_AUDIO_PAIR_COLUMNS",
          },
          { status: 409 }
        )
      }
      if (error instanceof InvalidAudioPairStateError && pairRole !== undefined) {
        return getInvalidAudioPairStateResponse(error.message || undefined)
      }
      if (isUniqueViolation(error) && pairRole !== undefined) {
        return NextResponse.json(
          {
            error: "No se pudo invertir la dupla porque los roles quedaron en conflicto. Reintenta o regraba la dupla.",
            code: "AUDIO_PAIR_ROLE_CONFLICT",
          },
          { status: 409 }
        )
      }

      if (!isMissingColumn(error)) {
        throw error
      }

      rows = await sql`
        UPDATE subject_day_entries
        SET
          transcript_text = CASE WHEN ${"transcriptText" in body} THEN ${transcriptText || ""} ELSE transcript_text END,
          answer_text = CASE WHEN ${"answerText" in body} THEN ${answerText} ELSE answer_text END,
          updated_at = NOW()
        WHERE id = ${entryId}
        RETURNING id, NULL::INTEGER AS subject_day_material_id, subject_id, week_number, session_date, weekday_index, order_index, transcript_text, drive_file_id, drive_file_name, drive_mime_type, drive_web_view_link, answer_text, NULL::TEXT AS custom_title, NULL::TEXT AS practice_state, NULL::TEXT AS pair_id, NULL::TEXT AS pair_role, FALSE AS is_featured, created_at, updated_at
      ` as EntryRow[]
    }

    if (!rows[0]) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 })
    }

    let entryWithLinks
    try {
      entryWithLinks = await withLinks(rows[0])
    } catch (error) {
      console.error("PATCH /api/subject-day-entries/[id] succeeded but failed to load links:", {
        entryId,
        databaseHost: getDatabaseHost(),
        error,
      })
      entryWithLinks = buildEntryResponse(rows[0], [])
    }

    return NextResponse.json(entryWithLinks)
  } catch (error) {
    console.error("PATCH /api/subject-day-entries/[id] error:", error)
    if (isMissingSubjectDayEntriesTable(error)) {
      return NextResponse.json(
        { error: "Falta crear la tabla subject_day_entries. Ejecuta scripts/005-create-subject-day-entries.sql y scripts/006-add-subject-day-entry-metadata.sql en Neon." },
        { status: 503 }
      )
    }
    if (isMissingColumn(error)) {
      return getMissingMetadataColumnResponse({})
    }
    return NextResponse.json({ error: "Failed to update entry" }, { status: 500 })
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const { id } = await context.params
    const entryId = Number.parseInt(id, 10)
    if (!Number.isInteger(entryId)) {
      return NextResponse.json({ error: "Invalid entry id" }, { status: 400 })
    }

    let entries: Array<{ id: number; drive_file_id: string; subject_id: string; pair_id: string | null }>
    try {
      entries = await sql`
        SELECT id, drive_file_id, subject_id, pair_id
        FROM subject_day_entries
        WHERE id = ${entryId}
      ` as Array<{ id: number; drive_file_id: string; subject_id: string; pair_id: string | null }>
    } catch (error) {
      if (!isMissingPairColumn(error)) throw error
      entries = await sql`
        SELECT id, drive_file_id, subject_id, NULL::TEXT AS pair_id
        FROM subject_day_entries
        WHERE id = ${entryId}
      ` as Array<{ id: number; drive_file_id: string; subject_id: string; pair_id: string | null }>
    }

    const entry = entries[0]
    if (!entry) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 })
    }

    const forbidden = ensureSubjectAccess(auth.session!, entry.subject_id)
    if (forbidden) return forbidden

    let pairRows = [{ id: entry.id, drive_file_id: entry.drive_file_id }]
    if (entry.pair_id) {
      try {
        pairRows = await sql`
          SELECT id, drive_file_id
          FROM subject_day_entries
          WHERE pair_id = ${entry.pair_id}
          ORDER BY id ASC
        ` as Array<{ id: number; drive_file_id: string }>
      } catch (error) {
        if (!isMissingPairColumn(error)) throw error
      }
    }

    for (const pairEntry of pairRows) {
      if (!pairEntry.drive_file_id) continue
      if (isR2ObjectKey(pairEntry.drive_file_id)) {
        await deleteR2Object(pairEntry.drive_file_id)
      } else {
        await deleteDriveFile(pairEntry.drive_file_id)
      }
    }

    const rows = entry.pair_id
      ? await sql`
          DELETE FROM subject_day_entries
          WHERE pair_id = ${entry.pair_id}
          RETURNING id
        ` as Array<{ id: number }>
      : await sql`
          DELETE FROM subject_day_entries
          WHERE id = ${entryId}
          RETURNING id
        ` as Array<{ id: number }>

    return NextResponse.json({ success: true, id: entryId, ids: rows.map((row) => row.id) })
  } catch (error) {
    console.error("DELETE /api/subject-day-entries/[id] error:", error)
    if (isMissingSubjectDayEntriesTable(error)) {
      return NextResponse.json(
        { error: "Falta crear la tabla subject_day_entries. Ejecuta scripts/005-create-subject-day-entries.sql y scripts/006-add-subject-day-entry-metadata.sql en Neon." },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: "Failed to delete entry" }, { status: 500 })
  }
}
