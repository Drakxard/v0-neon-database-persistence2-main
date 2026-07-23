import { neon } from '@neondatabase/serverless'
import { requireSql } from "@/lib/db"
import { ensureSubjectAccess, requireAuthSession } from "@/lib/authz"
import { readLocalState, updateLocalState } from "@/lib/local-state-store"
import { isLocalStorageMode } from "@/lib/storage-mode"

const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null

export async function GET(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const { searchParams } = new URL(request.url)
    const date = searchParams.get('date')
    const subjectId = searchParams.get('subjectId')

    if (!date || !subjectId) {
      return Response.json({ error: 'Missing parameters' }, { status: 400 })
    }

    const forbidden = ensureSubjectAccess(auth.session!, subjectId)
    if (forbidden) return forbidden

    if (isLocalStorageMode()) {
      const state = await readLocalState()
      return Response.json(state.subjectCompletions[`${date}:${subjectId}`] ?? null)
    }

    const result = await requireSql(sql)`
      SELECT id, date, subject_id, panorama, created_at, updated_at
      FROM subject_completions
      WHERE date = ${date} AND subject_id = ${subjectId}
      LIMIT 1
    `

    if (result.length === 0) {
      return Response.json(null)
    }

    return Response.json(result[0])
  } catch (error) {
    console.error('[v0] GET /api/subject-completions error:', error)
    return Response.json({ error: 'Failed to fetch completion' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const { date, subjectId, panorama } = await request.json()

    if (!date || !subjectId) {
      return Response.json({ error: 'Invalid request data' }, { status: 400 })
    }

    const forbidden = ensureSubjectAccess(auth.session!, subjectId)
    if (forbidden) return forbidden

    if (isLocalStorageMode()) {
      const result = await updateLocalState((state) => {
        const key = `${date}:${subjectId}`
        const current = state.subjectCompletions[key]
        const now = new Date().toISOString()
        const next = {
          id: current?.id ?? Number(`${Date.now()}${Math.floor(Math.random() * 100).toString().padStart(2, "0")}`),
          date,
          subject_id: subjectId,
          panorama: panorama || "",
          created_at: current?.created_at ?? now,
          updated_at: now,
        }
        state.subjectCompletions[key] = next
        return next
      })
      return Response.json(result)
    }

    // Check if completion exists
    const existing = await requireSql(sql)`
      SELECT id FROM subject_completions
      WHERE date = ${date} AND subject_id = ${subjectId}
      LIMIT 1
    `

    let result
    if (existing.length > 0) {
      // Update
      result = await requireSql(sql)`
        UPDATE subject_completions
        SET panorama = ${panorama || ''},
            updated_at = NOW()
        WHERE date = ${date} AND subject_id = ${subjectId}
        RETURNING id, date, subject_id, panorama, created_at, updated_at
      `
    } else {
      // Insert
      result = await requireSql(sql)`
        INSERT INTO subject_completions (date, subject_id, panorama)
        VALUES (${date}, ${subjectId}, ${panorama || ''})
        RETURNING id, date, subject_id, panorama, created_at, updated_at
      `
    }

    return Response.json(result[0])
  } catch (error) {
    console.error('[v0] POST /api/subject-completions error:', error)
    return Response.json({ error: 'Failed to save completion' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const { searchParams } = new URL(request.url)
    const date = searchParams.get('date')
    const subjectId = searchParams.get('subjectId')

    if (!date || !subjectId) {
      return Response.json({ error: 'Missing parameters' }, { status: 400 })
    }

    const forbidden = ensureSubjectAccess(auth.session!, subjectId)
    if (forbidden) return forbidden

    if (isLocalStorageMode()) {
      await updateLocalState((state) => {
        delete state.subjectCompletions[`${date}:${subjectId}`]
      })
      return Response.json({ success: true })
    }

    await requireSql(sql)`
      DELETE FROM subject_completions
      WHERE date = ${date} AND subject_id = ${subjectId}
    `

    return Response.json({ success: true })
  } catch (error) {
    console.error('[v0] DELETE /api/subject-completions error:', error)
    return Response.json({ error: 'Failed to delete completion' }, { status: 500 })
  }
}
