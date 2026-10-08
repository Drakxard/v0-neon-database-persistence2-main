"use client"

import { getReadyWorkspaceHandle, loadWorkspaceHandle, queryWorkspacePermission } from "./local-workspace-client"
import type { PdfSearchResult } from "./subject-pdf-search"

export const VOICE_IMAGE_COLORS = ["#b2f2bb", "#a5d8ff", "#ffec99", "#fcc2d7", "#d0bfff", "#ffd8a8"] as const
export type VoiceImage = { id: string; name: string; path: string }
export type VoiceImageGroup = { id: string; name: string; color: string; images: VoiceImage[]; pdfs?: PdfSearchResult[] }
export const voiceGroupItemCount = (group: VoiceImageGroup) => group.images.length + (group.pdfs?.length ?? 0)
export type VoiceImageWorkspace = { version: 1; subjectId: string; groups: VoiceImageGroup[] }

function subjectSegment(subjectId: string) {
  if (!subjectId.trim()) throw new Error("La materia no tiene un identificador válido.")
  return encodeURIComponent(subjectId).replace(/\./g, "%2E")
}

async function root() {
  const handle = getReadyWorkspaceHandle() ?? await loadWorkspaceHandle()
  if (!handle) throw new Error("Seleccioná la carpeta local de la app para guardar las imágenes.")
  if (await queryWorkspacePermission(handle) !== "granted") throw new Error("Volvé a autorizar la carpeta local de la app para leer y guardar imágenes.")
  return handle
}

async function fileHandle(handle: FileSystemDirectoryHandle, path: string, create = false) {
  const parts = path.split("/")
  if (parts.some((part) => !part || part === "." || part === ".." || part.includes("\\"))) throw new Error("Ruta de imagen inválida.")
  let directory = handle
  for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part, { create })
  return directory.getFileHandle(parts.at(-1)!, { create })
}

function manifestPath(subjectId: string) { return `manifests/subject-voice/${subjectSegment(subjectId)}/workspace.json` }

function validateWorkspace(value: unknown, subjectId: string): VoiceImageWorkspace {
  const workspace = value as VoiceImageWorkspace | null
  const prefix = `subject-voice/images/${subjectSegment(subjectId)}/`
  const ids = new Set<string>()
  if (!workspace || workspace.version !== 1 || workspace.subjectId !== subjectId || !Array.isArray(workspace.groups)) throw new Error("El archivo de conjuntos no es válido; no se reemplazó su contenido.")
  for (const group of workspace.groups) {
    if (!group || typeof group.id !== "string" || !group.id || ids.has(group.id) || typeof group.name !== "string" || !group.name.trim() || !VOICE_IMAGE_COLORS.includes(group.color as typeof VOICE_IMAGE_COLORS[number]) || !Array.isArray(group.images)) throw new Error("El archivo de conjuntos contiene un conjunto inválido.")
    ids.add(group.id)
    if (group.pdfs !== undefined && (!Array.isArray(group.pdfs) || new Set(group.pdfs.map((pdf) => pdf?.id)).size !== group.pdfs.length)) throw new Error("El conjunto contiene fragmentos de PDF inválidos.")
    for (const pdf of group.pdfs ?? []) {
      if (!pdf || typeof pdf.id !== "string" || !pdf.id || typeof pdf.title !== "string" || typeof pdf.fileId !== "string" || !pdf.fileId ||
        typeof pdf.hash !== "string" || !/^[a-f0-9]{64}$/.test(pdf.hash) || typeof pdf.fileName !== "string" || typeof pdf.query !== "string" || !Number.isInteger(pdf.week) ||
        !pdf.candidate || !Array.isArray(pdf.candidate.blocks) || !pdf.candidate.blocks.length || !Array.isArray(pdf.candidate.anchorIds) ||
        !pdf.decision || pdf.decision.accepted !== true || !Array.isArray(pdf.decision.blockIds) || !Array.isArray(pdf.decision.partialIds) ||
        [...pdf.decision.blockIds,...pdf.decision.partialIds].some((id) => !pdf.candidate.blocks.some((block) => block.id === id))) throw new Error("El conjunto contiene un fragmento de PDF inválido.")
    }
    for (const image of group.images) {
      if (!image || typeof image.id !== "string" || !image.id || ids.has(image.id) || typeof image.name !== "string" || !image.name || typeof image.path !== "string" || !image.path.startsWith(prefix) || !image.path.slice(prefix.length) || /[/\\]/.test(image.path.slice(prefix.length)) || [".", ".."].includes(image.path.slice(prefix.length))) throw new Error("El archivo de conjuntos contiene una imagen inválida.")
      ids.add(image.id)
    }
  }
  return workspace
}

async function load(handle: FileSystemDirectoryHandle, subjectId: string) {
  let file: FileSystemFileHandle
  try { file = await fileHandle(handle, manifestPath(subjectId)) }
  catch (error) {
    if (error instanceof DOMException && error.name === "NotFoundError") return { version: 1, subjectId, groups: [] } as VoiceImageWorkspace
    throw error
  }
  try { return validateWorkspace(JSON.parse(await (await file.getFile()).text()), subjectId) }
  catch (error) { throw new Error(`No se pudieron leer los conjuntos: ${error instanceof Error ? error.message : "archivo ilegible"}`) }
}

export async function loadVoiceImageGroups(subjectId: string) { return load(await root(), subjectId) }

async function writeVerified(handle: FileSystemDirectoryHandle, path: string, blob: Blob) {
  const file = await fileHandle(handle, path, true)
  const writer = await file.createWritable()
  try { await writer.write(blob); await writer.close() }
  catch (error) { await writer.abort().catch(() => {}); throw error }
  const [actual, expected] = await Promise.all([(await file.getFile()).arrayBuffer(), blob.arrayBuffer()])
  const bytes = new Uint8Array(actual), source = new Uint8Array(expected)
  if (bytes.length !== source.length || bytes.some((byte, index) => byte !== source[index])) throw new Error("No se pudo verificar el archivo guardado.")
}

export async function validateVoiceImageFiles(files: File[]) {
  const valid: File[] = [], rejected: string[] = []
  for (const file of files) {
    const url = URL.createObjectURL(file)
    try {
      const image = new Image()
      image.src = url
      await image.decode()
      if (!image.naturalWidth || !image.naturalHeight) throw new Error("Imagen vacía")
      valid.push(file)
    } catch { rejected.push(`${file.name}: no es una imagen decodificable.`) }
    finally { URL.revokeObjectURL(url) }
  }
  return { valid, rejected }
}

const queues = new Map<string, Promise<unknown>>()

async function inQueue<T>(subjectId: string, action: () => Promise<T>): Promise<T> {
  const previous = queues.get(subjectId) ?? Promise.resolve()
  const operation = previous.catch(() => {}).then(action)
  queues.set(subjectId, operation)
  try { return await operation }
  finally { if (queues.get(subjectId) === operation) queues.delete(subjectId) }
}

async function commit(handle: FileSystemDirectoryHandle, workspace: VoiceImageWorkspace, original: VoiceImageWorkspace) {
  validateWorkspace(workspace, workspace.subjectId)
  await writeVerified(handle, manifestPath(workspace.subjectId).replace("workspace.json", "workspace.backup.json"), new Blob([JSON.stringify(original)]))
  await writeVerified(handle, manifestPath(workspace.subjectId), new Blob([JSON.stringify(workspace)]))
}

export async function saveVoiceImages(subjectId: string, files: File[], target: { groupId: string } | { name: string; color: string }) {
  return inQueue(subjectId, async () => {
    const handle = await root()
    const workspace = await load(handle, subjectId)
    const group = "groupId" in target ? workspace.groups.find((item) => item.id === target.groupId) : {
      id: crypto.randomUUID(), name: target.name.trim(), color: target.color, images: [],
    } as VoiceImageGroup
    if (!group) throw new Error("El conjunto ya no está disponible.")
    if (!group.name || !VOICE_IMAGE_COLORS.includes(group.color as typeof VOICE_IMAGE_COLORS[number])) throw new Error("Elegí un nombre y un color válidos.")
    const failed: File[] = [], errors: string[] = []
    let saved = 0
    for (const file of files) {
      const id = crypto.randomUUID()
      const extension = /\.[a-zA-Z0-9]{1,10}$/.exec(file.name)?.[0] ?? ""
      const path = `subject-voice/images/${subjectSegment(subjectId)}/${id}${extension}`
      try {
        await writeVerified(handle, path, file)
        group.images.push({ id, name: file.name, path })
        saved++
      } catch (error) {
        failed.push(file)
        errors.push(`${file.name}: ${error instanceof Error ? error.message : "no se pudo guardar"}`)
      }
    }
    if (saved) {
      if (!("groupId" in target)) workspace.groups.push(group)
      // Keep the previous manifest before committing the new one.
      const original = await load(handle, subjectId)
      await commit(handle, workspace, original)
    }
    return { workspace, groupId: group.id, failed, errors }
  })
}

export async function regroupVoiceImages(subjectId: string, imageIds: string[], destination: { id: string; name: string; color: string }, pdfResults: PdfSearchResult[] = []) {
  return inQueue(subjectId, async () => {
    const handle = await root()
    const workspace = await load(handle, subjectId)
    const ids = new Set(imageIds)
    const pdfs = [...new Map(pdfResults.map((pdf) => [pdf.id, pdf])).values()]
    const pdfIds = new Set(pdfs.map((pdf) => pdf.id))
    if (!ids.size && !pdfs.length) throw new Error("No hay resultados para agrupar.")
    const existing = workspace.groups.find((group) => group.id === destination.id)
    // A retry after a successful disk commit must not create another group or move its pairs twice.
    if (existing) {
      if (existing.name === destination.name.trim() && existing.color === destination.color && existing.images.length === ids.size && existing.images.every((image) => ids.has(image.id)) &&
        (existing.pdfs?.length ?? 0) === pdfIds.size && (existing.pdfs ?? []).every((pdf) => pdfIds.has(pdf.id))) return workspace
      throw new Error("El identificador del nuevo conjunto ya está en uso.")
    }
    const original = structuredClone(workspace)
    const images = workspace.groups.flatMap((group) => group.images).filter((image) => ids.has(image.id))
    if (images.length !== ids.size) throw new Error("Las imágenes cambiaron. Volvé a buscar antes de crear el conjunto.")
    const groups = workspace.groups.flatMap((group) => {
      const remaining = group.images.filter((image) => !ids.has(image.id))
      const remainingPdfs = (group.pdfs ?? []).filter((pdf) => !pdfIds.has(pdf.id))
      return voiceGroupItemCount(group) > 0 && remaining.length + remainingPdfs.length === 0 ? [] : [{ ...group, images: remaining, ...(group.pdfs ? {pdfs:remainingPdfs} : {}) }]
    })
    const next: VoiceImageWorkspace = { ...workspace, groups: [...groups, { ...destination, name: destination.name.trim(), images, ...(pdfs.length ? {pdfs:structuredClone(pdfs)} : {}) }] }
    await commit(handle, next, original)
    return next
  })
}

export async function removeVoicePdfFragment(subjectId: string, groupId: string, pdfId: string) {
  return inQueue(subjectId, async () => {
    const handle = await root(), workspace = await load(handle, subjectId), original = structuredClone(workspace)
    const group = workspace.groups.find((item) => item.id === groupId)
    if (!group) throw new Error("El conjunto ya no está disponible.")
    group.pdfs = (group.pdfs ?? []).filter((pdf) => pdf.id !== pdfId)
    if (!voiceGroupItemCount(group)) workspace.groups = workspace.groups.filter((item) => item.id !== groupId)
    await commit(handle, workspace, original)
    return workspace
  })
}

export async function readVoiceImage(subjectId: string, image: VoiceImage) {
  const workspace = await loadVoiceImageGroups(subjectId)
  const stored = workspace.groups.flatMap((group) => group.images).find((item) => item.id === image.id && item.path === image.path)
  if (!stored) throw new Error("La imagen no pertenece a esta materia.")
  return (await fileHandle(await root(), stored.path)).getFile()
}
