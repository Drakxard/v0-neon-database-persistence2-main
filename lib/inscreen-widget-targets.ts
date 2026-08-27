import { RemoteFileNotFoundError } from "@/lib/remote-file-errors"
import { downloadR2Object, isR2PreconditionFailedError, uploadR2Object } from "@/lib/r2"

export const INSCREEN_WIDGET_TARGETS_KEY = "manifests/inscreen/provider/widget-targets-v1.json"

export type InscreenWidgetTargetKind = "notebooklm" | "materials"

export type InscreenWidgetTarget = {
  url: string
  revision: number
  updatedAt: string
  sectionKey?: string
  weekNumber?: number
}

export type InscreenWidgetSubject = {
  id: string
  name: string
  color: string
  targets: Partial<Record<InscreenWidgetTargetKind, InscreenWidgetTarget>>
}

export type InscreenWidgetTargetsManifest = {
  version: 1
  revision: number
  updatedAt: string
  subjects: InscreenWidgetSubject[]
}

export type InscreenWidgetTargetPatch = {
  subjectId: string
  kind: InscreenWidgetTargetKind
  url: string | null
  sectionKey?: string
  weekNumber?: number
}

const EMPTY_MANIFEST: InscreenWidgetTargetsManifest = {
  version: 1,
  revision: 0,
  updatedAt: "1970-01-01T00:00:00.000Z",
  subjects: [],
}

function normalizeUrl(value: unknown) {
  const raw = String(value || "").trim()
  if (!raw || raw.length > 4096) return null
  try {
    const url = new URL(raw)
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null
  } catch {
    return null
  }
}

function normalizeSubject(value: unknown): InscreenWidgetSubject | null {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {}
  const id = String(source.id || "").trim()
  const name = String(source.name || "").replace(/\s+/g, " ").trim()
  const color = String(source.color || "").trim()
  if (!/^[a-zA-Z0-9_-]{1,180}$/.test(id) || !name || name.length > 300 || !/^#[0-9a-fA-F]{6}$/.test(color)) return null
  return { id, name, color, targets: {} }
}

export function normalizeInscreenWidgetCatalog(value: unknown) {
  if (!Array.isArray(value) || value.length > 100) throw new Error("Catalogo de materias invalido.")
  const ids = new Set<string>()
  return value.map(normalizeSubject).filter((item): item is InscreenWidgetSubject => {
    if (!item || ids.has(item.id)) return false
    ids.add(item.id)
    return true
  })
}

function normalizeTarget(value: unknown): InscreenWidgetTarget | null {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {}
  const url = normalizeUrl(source.url)
  const revision = Number(source.revision)
  const updatedAt = String(source.updatedAt || "")
  if (!url || !Number.isSafeInteger(revision) || revision < 1 || !Number.isFinite(Date.parse(updatedAt))) return null
  const sectionKey = String(source.sectionKey || "").trim()
  const weekNumber = Number(source.weekNumber)
  return {
    url,
    revision,
    updatedAt,
    ...(sectionKey ? { sectionKey } : {}),
    ...(Number.isInteger(weekNumber) && weekNumber >= 0 ? { weekNumber } : {}),
  }
}

export function normalizeInscreenWidgetTargetsManifest(value: unknown): InscreenWidgetTargetsManifest {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {}
  const catalog = normalizeInscreenWidgetCatalog(source.subjects)
  const rawSubjects = Array.isArray(source.subjects) ? source.subjects : []
  for (const subject of catalog) {
    const raw = rawSubjects.find((candidate) => candidate && typeof candidate === "object" && String((candidate as Record<string, unknown>).id) === subject.id) as Record<string, unknown> | undefined
    const targets = raw?.targets && typeof raw.targets === "object" ? raw.targets as Record<string, unknown> : {}
    const notebooklm = normalizeTarget(targets.notebooklm)
    const materials = normalizeTarget(targets.materials)
    subject.targets = { ...(notebooklm ? { notebooklm } : {}), ...(materials ? { materials } : {}) }
  }
  const revision = Number(source.revision)
  const updatedAt = String(source.updatedAt || "")
  return {
    version: 1,
    revision: Number.isSafeInteger(revision) && revision >= 0 ? revision : 0,
    updatedAt: Number.isFinite(Date.parse(updatedAt)) ? updatedAt : EMPTY_MANIFEST.updatedAt,
    subjects: catalog,
  }
}

export async function readInscreenWidgetTargets() {
  try {
    const object = await downloadR2Object(INSCREEN_WIDGET_TARGETS_KEY)
    return { value: normalizeInscreenWidgetTargetsManifest(JSON.parse(object.buffer.toString("utf8"))), etag: object.etag }
  } catch (error) {
    if (error instanceof RemoteFileNotFoundError) return { value: { ...EMPTY_MANIFEST, subjects: [] }, etag: null }
    throw error
  }
}

export async function publishInscreenWidgetTargets(input: { subjects?: unknown; target?: InscreenWidgetTargetPatch | null }) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await readInscreenWidgetTargets()
    const revision = current.value.revision + 1
    const updatedAt = new Date().toISOString()
    const catalog = input.subjects === undefined ? current.value.subjects : normalizeInscreenWidgetCatalog(input.subjects)
    const previousById = new Map(current.value.subjects.map((subject) => [subject.id, subject]))
    const subjects = catalog.map((subject) => ({ ...subject, targets: { ...(previousById.get(subject.id)?.targets ?? {}) } }))
    if (input.target) {
      const subject = subjects.find((candidate) => candidate.id === input.target!.subjectId)
      if (!subject) throw new Error("La materia del destino no existe en el catalogo publicado.")
      if (input.target.kind !== "notebooklm" && input.target.kind !== "materials") throw new Error("Tipo de destino invalido.")
      if (input.target.url === null) {
        delete subject.targets[input.target.kind]
      } else {
        const url = normalizeUrl(input.target.url)
        if (!url) throw new Error("URL de destino invalida.")
        subject.targets[input.target.kind] = {
          url,
          revision,
          updatedAt,
          ...(input.target.sectionKey ? { sectionKey: String(input.target.sectionKey).slice(0, 300) } : {}),
          ...(Number.isInteger(input.target.weekNumber) && Number(input.target.weekNumber) >= 0 ? { weekNumber: Number(input.target.weekNumber) } : {}),
        }
      }
    }
    const next: InscreenWidgetTargetsManifest = { version: 1, revision, updatedAt, subjects }
    try {
      await uploadR2Object({
        objectKey: INSCREEN_WIDGET_TARGETS_KEY,
        mimeType: "application/json",
        body: JSON.stringify(next),
        ...(current.etag ? { ifMatch: current.etag } : { ifNoneMatch: "*" }),
      })
      return next
    } catch (error) {
      if (!isR2PreconditionFailedError(error) || attempt === 3) throw error
    }
  }
  throw new Error("No se pudo publicar el manifiesto de widgets.")
}

export function resolveInscreenWidgetTarget(manifest: InscreenWidgetTargetsManifest, subjectId: string, kind: InscreenWidgetTargetKind) {
  return manifest.subjects.find((subject) => subject.id === subjectId)?.targets[kind] ?? null
}
