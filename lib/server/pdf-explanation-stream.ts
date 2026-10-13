import { createUIMessageStreamResponse, jsonSchema, streamText, tool, toUIMessageStream, type LanguageModel } from "ai"
import { explanationHtml, explanationPrompt } from "../pdf-explanation.ts"

export function explanationStream(model: LanguageModel, question: string, transcription: string) {
  const result = streamText({
    model,
    prompt: explanationPrompt(question, transcription),
    tools: {
      renderExplanation: tool({
        description: "Entrega la interfaz didáctica animada para mostrarla encima del PDF mediante Vercel AI SDK UI. El HTML debe responder a la duda usando la transcripción proporcionada y funcionar sin conexión.",
        inputSchema: jsonSchema<{ html: string }>({
          type: "object",
          properties: { html: { type: "string", minLength: 1, maxLength: 1_500_000, description: "Documento HTML completo con pantallas, controles y animaciones didácticas." } },
          required: ["html"],
          additionalProperties: false,
        }),
        execute: async ({ html }) => ({ html: explanationHtml(html) }),
      }),
    },
    toolChoice: { type: "tool", toolName: "renderExplanation" },
    maxOutputTokens: 16_000,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(110_000),
  })
  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      sendReasoning: false,
      sendSources: false,
      onError: () => "No se pudo generar la explicación con AI Gateway. Volvé a intentarlo.",
    }),
    headers: { "Cache-Control": "no-store" },
  })
}
