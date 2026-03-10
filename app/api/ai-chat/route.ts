import Groq from 'groq-sdk'

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

export async function POST(request: Request) {
  try {
    const { userPrompt, completedContext } = await request.json()

    if (!userPrompt?.trim()) {
      return Response.json({ error: 'Empty prompt' }, { status: 400 })
    }

    const fullMessage = completedContext
      ? `${userPrompt}\n\nMaterias completadas hoy:\n${completedContext}`
      : userPrompt

    const completion = await groq.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [{ role: 'user', content: fullMessage }],
      temperature: 1,
      max_completion_tokens: 1024,
      top_p: 1,
      stream: true,
      stop: null,
    })

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of completion) {
            const text = chunk.choices[0]?.delta?.content ?? ''
            if (text) {
              controller.enqueue(encoder.encode(text))
            }
          }
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
      },
    })
  } catch (error) {
    console.error('POST /api/ai-chat error:', error)
    return Response.json({ error: 'Failed to call AI' }, { status: 500 })
  }
}
