export const CLEF_FLASH_MODEL = "@cf/cloudflare/clef-flash"

export type ClefQuestion =
  | { type: "noul"; instructions: string }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] }

type ClefEvaluation = {
  model?: string
  answers: Record<string, unknown>
  usage?: unknown
}

export function getClefConfiguration() {
  const token = process.env.cloudflareapi?.trim() ?? ""
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ?? ""
  const missing = [
    ...(!token ? ["cloudflareapi"] : []),
    ...(!accountId ? ["CLOUDFLARE_ACCOUNT_ID"] : []),
  ]
  return { token, accountId, missing, configured: missing.length === 0 }
}

// Server-side adapter ready for the future interaction flow. No default instructions are imposed.
export async function evaluateClefFlash(
  state: string | Record<string, unknown> | unknown[],
  questions: Record<string, ClefQuestion>,
  fetcher: typeof fetch = fetch
): Promise<ClefEvaluation> {
  const config = getClefConfiguration()
  if (!config.configured) throw new Error(`Falta configurar ${config.missing.join(" y ")}.`)
  const count = Object.keys(questions).length
  if (count < 1 || count > 64) throw new Error("Clef Flash necesita entre 1 y 64 preguntas.")

  const response = await fetcher(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/ai/run/${CLEF_FLASH_MODEL}`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "clef-flash", state, questions }),
      signal: AbortSignal.timeout(25_000),
      cache: "no-store",
    }
  )
  if (!response.ok) throw new Error(`Cloudflare no pudo evaluar la solicitud (HTTP ${response.status}).`)
  const payload = await response.json() as { success?: boolean; result?: ClefEvaluation }
  if (payload.success === false || !payload.result?.answers
    || Object.keys(questions).some((key) => !Object.hasOwn(payload.result!.answers, key))) {
    throw new Error("Cloudflare devolvió una evaluación inválida.")
  }
  return payload.result
}
