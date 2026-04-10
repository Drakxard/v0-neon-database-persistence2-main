import Groq from "groq-sdk"

import type { GroqModelOption } from "@/lib/study-types"

const groqApiKey = process.env.GROQ_API_KEY || ""
const groq = groqApiKey ? new Groq({ apiKey: groqApiKey }) : null

type GroqModelRow = {
  id?: string
  owned_by?: string
  active?: boolean
}

function normalizeOwnedBy(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "groq"
}

function shouldIncludeModel(modelId: string) {
  const normalized = modelId.toLowerCase()
  if (!normalized) return false
  if (normalized.includes("whisper")) return false
  if (normalized.includes("orpheus")) return false
  if (normalized.includes("tts")) return false
  if (normalized.includes("guard")) return false
  if (normalized.includes("moderation")) return false
  return true
}

function buildModelLabel(modelId: string, ownedBy: string) {
  return ownedBy && ownedBy.toLowerCase() !== "groq" ? `${modelId} · ${ownedBy}` : modelId
}

export function requireGroqClient() {
  if (!groq) {
    throw new Error("Missing GROQ_API_KEY")
  }

  return groq
}

export async function listGroqGenerationModels(): Promise<GroqModelOption[]> {
  const client = requireGroqClient()
  const response = await client.models.list()
  const data = Array.isArray(response?.data) ? response.data : []

  return data
    .map((item) => item as GroqModelRow)
    .filter((item) => typeof item.id === "string" && item.id.trim().length > 0)
    .filter((item) => item.active !== false)
    .map((item) => {
      const id = String(item.id || "").trim()
      const ownedBy = normalizeOwnedBy(item.owned_by)
      return {
        id,
        ownedBy,
        label: buildModelLabel(id, ownedBy),
      } satisfies GroqModelOption
    })
    .filter((item) => shouldIncludeModel(item.id))
    .sort((left, right) => left.label.localeCompare(right.label))
}

export async function validateGroqModelId(modelId: string) {
  const normalizedModelId = String(modelId || "").trim()
  if (!normalizedModelId) return null

  const models = await listGroqGenerationModels()
  return models.find((model) => model.id === normalizedModelId) ?? null
}
