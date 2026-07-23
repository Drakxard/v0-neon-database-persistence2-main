export type TagFilterMode = "and" | "or"

export function normalizeTagName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("es")
}

export function normalizeTagDisplayName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ")
}

export function normalizeTagSearch(value: string) {
  return normalizeTagName(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
}

export function matchesTagSearch(name: string, search: string) {
  const query = normalizeTagSearch(search.replace(/^#/, ""))
  return !query || normalizeTagSearch(name).includes(query)
}

export function materialMatchesTagFilter(
  materialTagIds: number[],
  selectedTagIds: number[],
  mode: TagFilterMode
) {
  if (selectedTagIds.length === 0) return true
  const assigned = new Set(materialTagIds)
  return mode === "and"
    ? selectedTagIds.every((tagId) => assigned.has(tagId))
    : selectedTagIds.some((tagId) => assigned.has(tagId))
}

export function wouldCreateTagCycle(
  tagId: number,
  parentId: number | null,
  parentByTagId: ReadonlyMap<number, number | null>
) {
  if (parentId == null) return false
  if (parentId === tagId) return true

  const visited = new Set<number>([tagId])
  let cursor: number | null | undefined = parentId
  while (cursor != null) {
    if (visited.has(cursor)) return true
    visited.add(cursor)
    cursor = parentByTagId.get(cursor)
  }
  return false
}

export function normalizeTagColor(value: string) {
  const normalized = value.trim().toLowerCase()
  return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : "#10b981"
}
