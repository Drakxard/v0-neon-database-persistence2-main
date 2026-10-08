"use client"

import { validateVoiceImageFiles, writeVerified, type VoiceImage } from "../subject-voice-images"
import { inPdfCacheQueue, pdfWorkspaceRoot, readPdfCache, readPdfCrop, writePdfCache } from "./subject-pdf-cache"

export type WeekTopics = { version: 1; subjectId: string; weekNumber: number; images: VoiceImage[] }
function paths(subjectId: string, weekNumber: number) {
  if (!subjectId.trim() || !Number.isSafeInteger(weekNumber) || weekNumber < 0) throw new Error("La materia o semana no son válidas.")
  const subject = encodeURIComponent(subjectId).replace(/\./g, "%2E")
  return {manifest:`manifests/subject-voice/topics/${subject}/week-${weekNumber}.json`,
    images:`subject-voice/topics/${subject}/week-${weekNumber}/`}
}
async function load(root: FileSystemDirectoryHandle, subjectId: string, weekNumber: number): Promise<WeekTopics> {
  const {manifest,images:prefix} = paths(subjectId,weekNumber)
  const saved = await readPdfCache<WeekTopics>(root,manifest)
  if (!saved) return {version:1,subjectId,weekNumber,images:[]}
  const ids = new Set<string>()
  if (saved.version !== 1 || saved.subjectId !== subjectId || saved.weekNumber !== weekNumber || !Array.isArray(saved.images)) throw new Error("El archivo de temas no es válido; no se reemplazó su contenido.")
  for (const image of saved.images) {
    if (!image || typeof image.id !== "string" || !image.id || ids.has(image.id) || typeof image.name !== "string" || !image.name ||
      typeof image.path !== "string" || !image.path.startsWith(prefix) || !image.path.slice(prefix.length) || /[/\\]/.test(image.path.slice(prefix.length)) ||
      [".",".."].includes(image.path.slice(prefix.length))) throw new Error("El archivo de temas contiene una imagen inválida.")
    ids.add(image.id)
  }
  return saved
}
export async function loadWeekTopics(subjectId: string, weekNumber: number) {
  return load(await pdfWorkspaceRoot(),subjectId,weekNumber)
}
export async function saveWeekTopics(subjectId: string, weekNumber: number, files: File[]) {
  const root = await pdfWorkspaceRoot(), scope = paths(subjectId,weekNumber)
  return inPdfCacheQueue(root,scope.manifest,async () => {
    const original = await load(root,subjectId,weekNumber), next = structuredClone(original)
    const {valid,rejected} = await validateVoiceImageFiles(files)
    const failed: File[] = [], errors = [...rejected]
    for (const file of valid) {
      const id = crypto.randomUUID(), extension = /\.[a-zA-Z0-9]{1,10}$/.exec(file.name)?.[0] ?? ""
      const path = scope.images + id + extension
      try {
        await writeVerified(root,path,file)
        next.images.push({id,name:file.name,path})
      } catch (error) {
        failed.push(file); errors.push(`${file.name}: ${error instanceof Error ? error.message : "No se pudo guardar."}`)
      }
    }
    if (next.images.length !== original.images.length) await writePdfCache(root,scope.manifest,next)
    return {workspace:next,failed,errors}
  })
}
export async function readWeekTopicImage(subjectId: string, weekNumber: number, image: VoiceImage) {
  const root = await pdfWorkspaceRoot(), workspace = await load(root,subjectId,weekNumber)
  const stored = workspace.images.find((item) => item.id === image.id && item.path === image.path)
  if (!stored) throw new Error("La imagen no pertenece a los temas de esta materia y semana.")
  const file = await readPdfCrop(root,stored.path)
  if (!file) throw new Error("No se encontró la imagen de temas en la carpeta local.")
  return file
}
