export const DEFAULT_FREE_EXPLANATION_MODEL = "poolside/laguna-s-2.1-free"
const preferredModels = [DEFAULT_FREE_EXPLANATION_MODEL, "inclusionai/ling-3.1-flash-free", "inclusionai/ling-3.1-flash"]

type CatalogModel = {
  id?: unknown; name?: unknown; type?: unknown; tags?: unknown; max_tokens?: unknown;
  supported_parameters?: unknown; pricing?: { input?: unknown; output?: unknown };
  deprecated_at?: unknown;
}

export class FreeExplanationModelsError extends Error {}

function zeroPrice(value: unknown) {
  return (typeof value === "number" || (typeof value === "string" && value.trim() !== "")) && Number(value) === 0
}

export function chooseFreeExplanationModels(catalog: unknown, preferred?: string, now = Date.now()) {
  const data = (catalog as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) throw new FreeExplanationModelsError("No se pudo comprobar el catálogo gratuito de AI Gateway. Volvé a intentar.")
  const free = (data as CatalogModel[]).filter(model => model && typeof model.id === "string" && model.type === "language"
    && zeroPrice(model.pricing?.input) && zeroPrice(model.pricing?.output)
    && typeof model.max_tokens === "number" && model.max_tokens >= 1800
    && (typeof model.deprecated_at !== "number" || model.deprecated_at > now))
  const priority = [preferred?.trim(), ...preferredModels].filter(Boolean)
  free.sort((a, b) => {
    const rank = (id: unknown) => priority.includes(id as string) ? priority.indexOf(id as string) : priority.length
    return rank(a.id) - rank(b.id)
  })
  if (!free.length) throw new FreeExplanationModelsError("AI Gateway no ofrece ahora un modelo gratuito compatible con Verlo. La generación se detuvo sin usar modelos pagos.")
  return free.map(model => ({ id: model.id as string, name: typeof model.name === "string" ? model.name : model.id as string,
    maxOutputTokens: Math.min(16_000, model.max_tokens as number),
    supportsTools: Array.isArray(model.supported_parameters) && model.supported_parameters.includes("tools") && model.supported_parameters.includes("tool_choice"),
  }))
}

export async function freeExplanationModels(preferred?: string) {
  let catalog: unknown
  try {
    // Prices/promotions can change. Never select from a stale cached catalog.
    const response = await fetch("https://ai-gateway.vercel.sh/v1/models", { cache: "no-store", signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new Error()
    catalog = await response.json()
  } catch {
    throw new FreeExplanationModelsError("No se pudo comprobar el catálogo gratuito de AI Gateway. Volvé a intentar.")
  }
  return chooseFreeExplanationModels(catalog, preferred)
}
