export const UNASSIGNED_WORKSPACE_TAB_ID = "tab-unassigned"
export const UNASSIGNED_WORKSPACE_TAB_NAME = "Sin pestaña"

export type LocalSubjectCatalogEntry = {
  id: string
  name: string
  normalizedName: string
  storageKey: string
  createdAt: string
  updatedAt: string
}

export type LocalSubjectCatalog = {
  version: 2
  subjects: Record<string, LocalSubjectCatalogEntry>
}

export type LegacyLocalSubjectCatalogEntry = LocalSubjectCatalogEntry & {
  sourceIds?: string[]
  recovered?: boolean
}

export type LegacyLocalSubjectCatalog = {
  version?: 1 | 2
  subjects?: Record<string, Partial<LegacyLocalSubjectCatalogEntry>>
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

export function createLocalSubjectDirectoryName(value: string) {
  const normalized = String(value || "")
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
  const name = normalized || "Materia"
  const windowsReservedName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
  return windowsReservedName.test(name) ? `${name}-` : name
}

export function createEmptyLocalSubjectCatalog(): LocalSubjectCatalog {
  return { version: 2, subjects: {} }
}

export function normalizeLocalSubjectCatalog(input: LegacyLocalSubjectCatalog | null | undefined): LocalSubjectCatalog {
  const subjects = Object.entries(input?.subjects ?? {}).reduce<Record<string, LocalSubjectCatalogEntry>>(
    (accumulator, [key, value]) => {
      if (!value || typeof value !== "object") return accumulator
      const id = String(value.id || key).trim()
      const safeName = createLocalSubjectDirectoryName(String(value.name || "").trim())
      const storageKey = createLocalSubjectDirectoryName(String(value.storageKey || safeName).trim())
      if (!id || !safeName || !storageKey) return accumulator
      const timestamp = new Date().toISOString()
      accumulator[id] = {
        id,
        name: safeName,
        normalizedName: normalizeLocalSubjectName(safeName),
        storageKey,
        createdAt: typeof value.createdAt === "string" ? value.createdAt : timestamp,
        updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : timestamp,
      }
      return accumulator
    },
    {}
  )
  return { version: 2, subjects }
}

export function getLegacyLocalSubjectSources(input: LegacyLocalSubjectCatalog | null | undefined) {
  return Object.entries(input?.subjects ?? {}).reduce<Record<string, string[]>>((accumulator, [key, value]) => {
    if (!value || typeof value !== "object") return accumulator
    const id = String(value.id || key).trim()
    if (!id) return accumulator
    accumulator[id] = Array.from(new Set([
      id,
      String(value.storageKey || "").trim(),
      ...(Array.isArray(value.sourceIds) ? value.sourceIds.map((sourceId) => String(sourceId || "").trim()) : []),
    ].filter(Boolean)))
    return accumulator
  }, {})
}

export function findCatalogSubjectByName(catalog: LocalSubjectCatalog, name: string) {
  const normalizedName = normalizeLocalSubjectName(name)
  return Object.values(catalog.subjects).find((subject) => subject.normalizedName === normalizedName) ?? null
}

export function findCatalogSubjectByDirectoryName(catalog: LocalSubjectCatalog, directoryName: string) {
  const directoryKey = createLocalSubjectStorageKey(directoryName)
  return Object.values(catalog.subjects).find((subject) =>
    createLocalSubjectStorageKey(subject.name) === directoryKey ||
    createLocalSubjectStorageKey(subject.storageKey) === directoryKey
  ) ?? null
}

export function findCatalogSubjectByAnyId(catalog: LocalSubjectCatalog, subjectId: string) {
  return catalog.subjects[subjectId] ??
    Object.values(catalog.subjects).find((subject) => subject.storageKey === subjectId) ??
    null
}

export function allocateLocalSubjectId(catalog: LocalSubjectCatalog, name: string) {
  const base = createLocalSubjectStorageKey(name)
  if (!catalog.subjects[base]) return base
  let suffix = 2
  while (catalog.subjects[`${base}-${suffix}`]) suffix += 1
  return `${base}-${suffix}`
}

// Kept as an alias for callers created before catalog v2.
export const allocateLocalSubjectStorageKey = allocateLocalSubjectId
