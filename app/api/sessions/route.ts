import { neon } from '@neondatabase/serverless'
import { ensureSubjectAccess, requireAuthSession } from "@/lib/authz"
import { normalizeAllowedSubjectIds } from "@/lib/subjects"
import { parseDateKey } from "@/lib/server/request-parsing"

const sql = neon(process.env.DATABASE_URL!)

export async function GET(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const { searchParams } = new URL(request.url)
    const date = parseDateKey(searchParams.get('date'))

    if (!date) {
      return Response.json({ error: 'Missing date parameter' }, { status: 400 })
    }

    const result = await sql`
      SELECT id, date, active_subject_ids, completed_subjects, show_all_subjects
      FROM daily_sessions
      WHERE date = ${date}
      LIMIT 1
    `

    if (result.length === 0) {
      return Response.json(null)
    }

    // Parse JSON fields if they are strings
    const row = result[0]
    const activeSubjectIds = typeof row.active_subject_ids === 'string' 
      ? JSON.parse(row.active_subject_ids) 
      : row.active_subject_ids
    const completedSubjects = typeof row.completed_subjects === 'string'
      ? JSON.parse(row.completed_subjects)
      : row.completed_subjects

    const allowedSubjectIds = auth.session!.allowedSubjectIds
    const filteredActiveSubjectIds = auth.session!.isAdmin
      ? activeSubjectIds
      : normalizeAllowedSubjectIds(activeSubjectIds).filter((subjectId: string) => allowedSubjectIds.includes(subjectId))
    const filteredCompletedSubjects = auth.session!.isAdmin
      ? completedSubjects
      : Object.fromEntries(
          Object.entries(completedSubjects || {}).filter(([subjectId]) => allowedSubjectIds.includes(subjectId))
        )

    return Response.json({
      ...row,
      active_subject_ids: filteredActiveSubjectIds,
      completed_subjects: filteredCompletedSubjects,
      show_all_subjects: Boolean(row.show_all_subjects),
    })
  } catch (error) {
    console.error('[v0] GET /api/sessions error:', error)
    return Response.json({ error: 'Failed to fetch session' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const rawBody = await request.text()
    if (!rawBody.trim()) {
      return Response.json({ error: 'Empty request body' }, { status: 400 })
    }

    const { date: rawDate, activeSubjectIds, completedSubjects, showAllSubjects } = JSON.parse(rawBody)
    const date = parseDateKey(rawDate)

    if (!date || !Array.isArray(activeSubjectIds)) {
      return Response.json({ error: 'Invalid request data' }, { status: 400 })
    }

    const normalizedActiveSubjectIds = normalizeAllowedSubjectIds(activeSubjectIds)
    for (const subjectId of normalizedActiveSubjectIds) {
      const forbidden = ensureSubjectAccess(auth.session!, subjectId)
      if (forbidden) return forbidden
    }

    const normalizedCompletedSubjects = Object.fromEntries(
      Object.entries(completedSubjects || {}).filter(([subjectId]) => !ensureSubjectAccess(auth.session!, subjectId))
    )

    // Check if session exists
    const existing = await sql`
      SELECT id FROM daily_sessions
      WHERE date = ${date}
      LIMIT 1
    `

    let result
    if (existing.length > 0) {
      // Update
      result = await sql`
        UPDATE daily_sessions
        SET active_subject_ids = ${JSON.stringify(normalizedActiveSubjectIds)},
            completed_subjects = ${JSON.stringify(normalizedCompletedSubjects)},
            show_all_subjects = ${Boolean(showAllSubjects)},
            updated_at = NOW()
        WHERE date = ${date}
        RETURNING id, date, active_subject_ids, completed_subjects, show_all_subjects
      `
    } else {
      // Insert
      result = await sql`
        INSERT INTO daily_sessions (date, active_subject_ids, completed_subjects, show_all_subjects)
        VALUES (${date}, ${JSON.stringify(normalizedActiveSubjectIds)}, ${JSON.stringify(normalizedCompletedSubjects)}, ${Boolean(showAllSubjects)})
        RETURNING id, date, active_subject_ids, completed_subjects, show_all_subjects
      `
    }

    return Response.json(result[0])
  } catch (error) {
    console.error('[v0] POST /api/sessions error:', error)
    return Response.json({ error: 'Failed to save session' }, { status: 500 })
  }
}
