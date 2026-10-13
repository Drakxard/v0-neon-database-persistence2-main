import { createUIMessageStream, createUIMessageStreamResponse, jsonSchema, streamText, tool, toUIMessageStream, type LanguageModel } from "ai"
import { explanationHtml, explanationPrompt } from "../pdf-explanation.ts"
import { explanationFailure } from "../pdf-explanation-errors.ts"
import { explanationLessonSchema, lessonHtml, lessonFromText, type ExplanationLesson } from "../pdf-explanation-lesson.ts"

export function explanationStream(model: LanguageModel, question: string, transcription: string,
  options: { fallbackModels?: string[]; recoveryModel?: LanguageModel; maxOutputTokens?: number; supportsTools?: boolean; reasoning?: "none" | "low"; provider?: "azure" | "gateway" } = {}) {
  let failureDiagnostics: ReturnType<typeof explanationFailure>["diagnostics"] | undefined
  const reportError = (error: unknown) => {
    const failure = explanationFailure(error, options.provider)
    failureDiagnostics = failure.diagnostics
    console.error("[PDF explicación] AI Gateway", failure.diagnostics)
    return failure.message
  }
  const result = streamText({
    model,
    prompt: explanationPrompt(question, transcription, options.supportsTools === false ? "text" : "tool"),
    ...(options.supportsTools === false ? {} : {
    tools: {
      renderExplanation: tool({
        description: "Entrega title y steps: contenido breve de la explicación. La plantilla del servidor crea el HTML animado y AI SDK UI lo muestra. No generes código HTML, CSS ni JavaScript.",
        inputSchema: jsonSchema<ExplanationLesson | { html: string }>({ anyOf: [explanationLessonSchema, {
          type: "object", properties: { html: { type: "string", minLength: 1, maxLength: 1_500_000 } },
          required: ["html"], additionalProperties: false,
        }] }),
        execute: async input => ({ html: explanationHtml("html" in input ? input.html : lessonHtml(input)) }),
      }),
    },
    // Free models can return the document as text; a forced tool would make
    // AI SDK reject that otherwise usable response before it reaches the UI.
    toolChoice: "auto",
    } as const),
    reasoning: options.reasoning ?? "none",
    maxOutputTokens: options.provider === "azure" ? (options.maxOutputTokens ?? 12_000) : Math.min(options.maxOutputTokens ?? 1_800, 1_800),
    ...(options.provider === "azure"
      ? { providerOptions: { openai: { forceReasoning: true, reasoningEffort: "low", reasoningSummary: null } } }
      : options.fallbackModels?.length ? { providerOptions: { gateway: { models: options.fallbackModels } } } : {}),
    maxRetries: 0,
    onError: ({ error }) => { reportError(error) },
  })
  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: async ({ writer }) => {
        const diagnostic = (stage: string, details: Record<string, unknown> = {}) => writer.write({
          type: "data-explanation-debug", data: { version: "verlo-debug-v1", stage, ...details },
        })
        diagnostic("modelo-principal", { model: typeof model === "object" ? model.modelId : model, fallbackModels: options.fallbackModels })
        let delivered = false
        let failed = false
        let toolError: string | undefined
        const reader = toUIMessageStream({
          stream: result.stream,
          sendReasoning: false,
          sendSources: false,
          onError: reportError,
        }).getReader()
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            if (value.type === "tool-input-error") {
              toolError = value.errorText
              diagnostic("argumentos-herramienta-invalidos", { input: value.input, error: value.errorText, toolName: value.toolName })
              // AI SDK maps this event to output-error on the client. Suppress
              // it until recovery has had a chance to deliver usable HTML.
              continue
            }
            // Finish only after checking that a usable interface was delivered.
            if (value.type === "finish") { diagnostic("modelo-principal-finalizado", { finishReason: value.finishReason }); continue }
            if (value.type === "tool-output-error") {
              toolError = value.errorText
              diagnostic("html-herramienta-invalido", { error: value.errorText })
              continue
            }
            if (value.type === "tool-output-available") delivered = true
            if (value.type === "abort") {
              failed = true
              diagnostic("solicitud-interrumpida")
              writer.write({ type: "error", errorText: options.provider === "azure" ? "Azure interrumpió la generación. Presioná Enter para reintentar." : "AI Gateway interrumpió la generación. Elegí otro modelo para reintentar." })
              continue
            }
            if (value.type === "error") { failed = true; diagnostic("error-gateway", { error: value.errorText, diagnostics: failureDiagnostics }) }
            writer.write(value)
          }
        } finally {
          reader.releaseLock()
        }
        if (failed) return
        if (!delivered) {
          // Some free models return HTML as text instead of calling the tool.
          // Keep the same SDK UI transport and validate before exposing it.
          let text = await result.text
          let reason = await result.finishReason
          diagnostic("validacion-html", { text, finishReason: reason, usage: await result.totalUsage, toolError })
          const extract = (text: string) => lessonFromText(text) || text.match(/(?:<!doctype html[^>]*>\s*)?<html\b[\s\S]*?<\/html>/i)?.[0]
          let document = extract(text)
          if (!document && options.recoveryModel) {
            diagnostic("modelo-recuperacion", { model: typeof options.recoveryModel === "object" ? options.recoveryModel.modelId : options.recoveryModel })
            writer.write({ type: "data-explanation-status", data: { text: "El primer modelo no terminó; probando otro modelo gratuito…" } })
            const recovery = streamText({
              model: options.recoveryModel,
              prompt: explanationPrompt(question, transcription, "text"),
              reasoning: "none",
              maxOutputTokens: Math.min(options.maxOutputTokens ?? 1_800, 1_800),
              maxRetries: 0,
              onError: ({ error }) => { reportError(error) },
            })
            const recoveryReader = toUIMessageStream({ stream: recovery.stream, sendReasoning: false, sendSources: false,
              onError: reportError }).getReader()
            try {
              while (true) {
                const { done, value } = await recoveryReader.read()
                if (done) break
                if (value.type === "start" || value.type === "finish") continue
                if (value.type === "abort") {
                  failed = true
                  writer.write({ type: "error", errorText: reportError({ name: "TimeoutError" }) })
                  continue
                }
                if (value.type === "error") { failed = true; diagnostic("error-modelo-recuperacion", { error: value.errorText, diagnostics: failureDiagnostics }) }
                writer.write(value)
              }
            } finally { recoveryReader.releaseLock() }
            if (failed) return
            text = await recovery.text
            reason = await recovery.finishReason
            diagnostic("validacion-html-recuperacion", { text, finishReason: reason, usage: await recovery.totalUsage })
            document = extract(text)
          }
          if (document) {
            writer.write({ type: "data-explanation", data: { html: explanationHtml(document) } })
          } else {
            console.error("[PDF explicación] Sin HTML", { finishReason: reason, textLength: text.length, toolError: Boolean(toolError) })
            writer.write({ type: "error", errorText: reason === "length"
              ? "El modelo agotó su límite antes de completar el HTML. Presioná Enter para reintentar; la página ya está transcrita."
              : "El modelo terminó sin entregar HTML completo. Presioná Enter para reintentar; la página ya está transcrita." })
            return
          }
        }
        diagnostic("html-validado")
        writer.write({ type: "finish" })
      },
      onError: reportError,
    }),
    headers: { "Cache-Control": "no-store" },
    keepAliveMs: 10_000,
  })
}
