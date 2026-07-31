export const RECOVERED_WORKSPACE_TAB_ID = "tab-recovered"

export type LocalSubjectCatalogEntry = {
  id: string
  name: string
  normalizedName: string
  storageKey: string
  sourceIds: string[]
  createdAt: string
  updatedAt: string
  recovered: boolean
}

export type LocalSubjectCatalog = {
  version: 1
  subjects: Record<string, LocalSubjectCatalogEntry>
}

export function normalizeLocalSubjectName(value: string) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("es")
}

export function createLocalSubjectStorageKey(value: string) {
  return normalizeLocalSubjectName(value)
    .replace(/[^a-z0-9._ -]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "materia"
}

export function createEmptyLocalSubjectCatalog(): LocalSubjectCatalog {
  return { version: 1, subjects: {} }
}

export function normalizeLocalSubjectCatalog(input: Partial<LocalSubjectCatalog> | null | undefined) {
  const subjects = Object.entries(input?.subjects ?? {}).reduce<Record<string, LocalSubjectCatalogEntry>>(
    (accumulator, [key, value]) => {
      if (!value || typeof value !== "object") return accumulator
      const id = String(value.id || key).trim()
      const name = String(value.name || "").trim()
      const storageKey = String(value.storageKey || id).trim()
      if (!id || !name || !storageKey) return accumulator
      const timestamp = new Date().toISOString()
      accumulator[id] = {
        id,
        name,
        normalizedName: normalizeLocalSubjectName(value.normalizedName || name),
        storageKey,
        sourceIds: Array.from(new Set([storageKey, ...(Array.isArray(value.sourceIds) ? value.sourceIds : [])]))
          .map((sourceId) => String(sourceId || "").trim())
          .filter(Boolean),
        createdAt: typeof value.createdAt === "string" ? value.createdAt : timestamp,
        updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : timestamp,
        recovered: Boolean(value.recovered),
      }
      return accumulator
    },
    {}
  )
  return { version: 1 as const, subjects }
}

export function findCatalogSubjectByName(catalog: LocalSubjectCatalog, name: string) {
  const normalizedName = normalizeLocalSubjectName(name)
  return Object.values(catalog.subjects).find((subject) => subject.normalizedName === normalizedName) ?? null
}

export function findCatalogSubjectByAnyId(catalog: LocalSubjectCatalog, subjectId: string) {
  return catalog.subjects[subjectId] ??
    Object.values(catalog.subjects).find((subject) => subject.sourceIds.includes(subjectId)) ??
    null
}

export function allocateLocalSubjectStorageKey(catalog: LocalSubjectCatalog, name: string) {
  const base = createLocalSubjectStorageKey(name)
  const used = new Set(
    Object.values(catalog.subjects).flatMap((subject) => [subject.storageKey, ...subject.sourceIds])
  )
  if (!used.has(base)) return base
  let suffix = 2
  while (used.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

export function mergeCatalogSubjects(
  catalog: LocalSubjectCatalog,
  targetId: string,
  sourceIds: string[]
) {
  const normalized = normalizeLocalSubjectCatalog(catalog)
  const target = findCatalogSubjectByAnyId(normalized, targetId)
  if (!target) return normalized

  const mergedEntryIds = new Set<string>()
  const mergedSources = new Set(target.sourceIds)
  for (const sourceId of sourceIds) {
    if (!sourceId) continue
    const entry = findCatalogSubjectByAnyId(normalized, sourceId)
    if (entry && entry.id !== target.id) {
      mergedEntryIds.add(entry.id)
      entry.sourceIds.forEach((id) => mergedSources.add(id))
    } else {
      mergedSources.add(sourceId)
    }
  }

  const subjects = { ...normalized.subjects }
  for (const id of mergedEntryIds) delete subjects[id]
  const nextSourceIds = Array.from(mergedSources)
  const isUnchanged = mergedEntryIds.size === 0 &&
    target.recovered === false &&
    nextSourceIds.length === target.sourceIds.length &&
    nextSourceIds.every((sourceId) => target.sourceIds.includes(sourceId))
  if (isUnchanged) return normalized
  subjects[target.id] = {
    ...target,
    sourceIds: nextSourceIds,
    recovered: false,
    updatedAt: new Date().toISOString(),
  }
  return { version: 1 as const, subjects }
}
