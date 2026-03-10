import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.DATABASE_URL!)

export async function GET() {
  try {
    const result = await sql`SELECT prompt FROM ai_prompt WHERE id = 1`
    const prompt = result.length > 0 ? result[0].prompt : ''
    return Response.json({ prompt })
  } catch (error) {
    console.error('GET /api/ai-prompt error:', error)
    return Response.json({ error: 'Failed to fetch prompt' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { prompt } = await request.json()
    await sql`
      INSERT INTO ai_prompt (id, prompt, updated_at)
      VALUES (1, ${prompt}, NOW())
      ON CONFLICT (id) DO UPDATE SET prompt = ${prompt}, updated_at = NOW()
    `
    return Response.json({ ok: true })
  } catch (error) {
    console.error('POST /api/ai-prompt error:', error)
    return Response.json({ error: 'Failed to save prompt' }, { status: 500 })
  }
}
