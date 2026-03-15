import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const date = searchParams.get('date')

    if (!date) {
      return Response.json({ error: 'Missing date parameter' }, { status: 400 })
    }

    const result = await sql`
      SELECT id, date, active_subject_ids, completed_subjects
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

    return Response.json({
      ...row,
      active_subject_ids: activeSubjectIds,
      completed_subjects: completedSubjects,
    })
  } catch (error) {
    console.error('[v0] GET /api/sessions error:', error)
    return Response.json({ error: 'Failed to fetch session' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text()
    if (!rawBody.trim()) {
      return Response.json({ error: 'Empty request body' }, { status: 400 })
    }

    const { date, activeSubjectIds, completedSubjects } = JSON.parse(rawBody)

    if (!date || !Array.isArray(activeSubjectIds)) {
      return Response.json({ error: 'Invalid request data' }, { status: 400 })
    }

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
        SET active_subject_ids = ${JSON.stringify(activeSubjectIds)},
            completed_subjects = ${JSON.stringify(completedSubjects || {})},
            updated_at = NOW()
        WHERE date = ${date}
        RETURNING id, date, active_subject_ids, completed_subjects
      `
    } else {
      // Insert
      result = await sql`
        INSERT INTO daily_sessions (date, active_subject_ids, completed_subjects)
        VALUES (${date}, ${JSON.stringify(activeSubjectIds)}, ${JSON.stringify(completedSubjects || {})})
        RETURNING id, date, active_subject_ids, completed_subjects
      `
    }

    return Response.json(result[0])
  } catch (error) {
    console.error('[v0] POST /api/sessions error:', error)
    return Response.json({ error: 'Failed to save session' }, { status: 500 })
  }
}
