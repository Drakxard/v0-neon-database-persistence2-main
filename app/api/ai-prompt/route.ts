import { neon } from '@neondatabase/serverless'
import { readLocalState, updateLocalState } from "@/lib/local-state-store"
import { isLocalStorageMode } from "@/lib/storage-mode"

const sql = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null

export async function GET() {
  try {
    if (isLocalStorageMode()) {
      const state = await readLocalState()
      return Response.json({ prompt: state.aiPrompt })
    }

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
    if (isLocalStorageMode()) {
      await updateLocalState((state) => {
        state.aiPrompt = typeof prompt === "string" ? prompt : ""
      })
      return Response.json({ ok: true })
    }

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
