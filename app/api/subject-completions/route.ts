import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const date = searchParams.get('date')
    const subjectId = searchParams.get('subjectId')

    if (!date || !subjectId) {
      return Response.json({ error: 'Missing parameters' }, { status: 400 })
    }

    const result = await sql`
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
    const { date, subjectId, panorama } = await request.json()

    if (!date || !subjectId) {
      return Response.json({ error: 'Invalid request data' }, { status: 400 })
    }

    // Check if completion exists
    const existing = await sql`
      SELECT id FROM subject_completions
      WHERE date = ${date} AND subject_id = ${subjectId}
      LIMIT 1
    `

    let result
    if (existing.length > 0) {
      // Update
      result = await sql`
        UPDATE subject_completions
        SET panorama = ${panorama || ''},
            updated_at = NOW()
        WHERE date = ${date} AND subject_id = ${subjectId}
        RETURNING id, date, subject_id, panorama, created_at, updated_at
      `
    } else {
      // Insert
      result = await sql`
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
    const { searchParams } = new URL(request.url)
    const date = searchParams.get('date')
    const subjectId = searchParams.get('subjectId')

    if (!date || !subjectId) {
      return Response.json({ error: 'Missing parameters' }, { status: 400 })
    }

    await sql`
      DELETE FROM subject_completions
      WHERE date = ${date} AND subject_id = ${subjectId}
    `

    return Response.json({ success: true })
  } catch (error) {
    console.error('[v0] DELETE /api/subject-completions error:', error)
    return Response.json({ error: 'Failed to delete completion' }, { status: 500 })
  }
}
