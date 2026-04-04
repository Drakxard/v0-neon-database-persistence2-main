export function parseRequiredString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

export function parseOptionalInteger(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value)) return value
  if (typeof value !== "string") return Number.NaN
  return Number.parseInt(value, 10)
}

export function parseOptionalNonNegativeInteger(value: unknown) {
  const parsed = parseOptionalInteger(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : Number.NaN
}

export function parseDateKey(value: unknown) {
  const normalized = parseRequiredString(value)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null

  const parsed = new Date(`${normalized}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return null
  return normalized
}
