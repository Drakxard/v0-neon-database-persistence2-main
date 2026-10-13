export type ExplanationAttempt = {
  question: string; page?: number; model?: string; stage: string; startedAt: string; finishedAt?: string;
  outcome?: "exito" | "fallo"; html?: string; error?: string; transcription?: string;
  httpStatus?: number; responseBody?: string; wire?: string; parts?: unknown[];
}

const escape = (text: string) => text.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!)

export function explanationDownload(attempt: ExplanationAttempt) {
  const details = JSON.stringify({ format: "verlo-debug-v1", ...attempt, html: undefined }, null, 2)
  const report = `<details style="background:#fff;color:#111;padding:16px;border:1px solid #aaa"><summary>Diagnóstico Verlo · ${escape(attempt.outcome || "fallo")} · ${escape(attempt.stage)}</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${escape(details)}</pre></details>`
  const html = attempt.outcome === "exito" && attempt.html
    ? /<\/body>/i.test(attempt.html)
      ? attempt.html.replace(/<\/body>/i, () => `${report}</body>`)
      : attempt.html.replace(/<\/html>/i, () => `${report}</html>`)
    : `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Verlo · diagnóstico de fallo</title></head><body style="font-family:system-ui;max-width:1000px;margin:24px auto;padding:16px"><h1>Verlo · fallo</h1><p>Etapa: ${escape(attempt.stage)}</p><p>${escape(attempt.error || "No se recibió HTML completo.")}</p><h2>HTML recibido (sin ejecutar)</h2><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${escape(attempt.html || "Sin documento HTML completo. La respuesta y los fragmentos recibidos están en el diagnóstico.")}</pre>${report.replace("<details ", "<details open ")}</body></html>`
  const date = (attempt.finishedAt || attempt.startedAt).replace(/[^0-9T]/g, "-")
  return { html, filename: `verlo-pagina-${attempt.page ?? "pdf"}-${attempt.outcome || "fallo"}-${date}.html` }
}

export function downloadPdfExplanationAttempt(attempt: ExplanationAttempt) {
  const file = explanationDownload(attempt)
  const url = URL.createObjectURL(new Blob([file.html], { type: "text/html;charset=utf-8" }))
  const link = document.createElement("a")
  link.href = url
  link.download = file.filename
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
