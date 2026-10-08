"use client"

import { getReadyWorkspaceHandle, loadWorkspaceHandle, queryWorkspacePermission } from "../local-workspace-client"

export async function pdfWorkspaceRoot() {
  const root = getReadyWorkspaceHandle() ?? await loadWorkspaceHandle()
  if (!root || await queryWorkspacePermission(root) !== "granted") throw new Error("Autorizá la carpeta local para preparar los PDF.")
  return root
}
async function handle(root: FileSystemDirectoryHandle, path: string, create = false) {
  const parts = path.split("/")
  if (parts.some((p) => !p || p === "." || p === ".." || p.includes("\\"))) throw new Error("Ruta de caché inválida.")
  let directory = root
  for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part, { create })
  return directory.getFileHandle(parts.at(-1)!, { create })
}
export async function readPdfCache<T>(root: FileSystemDirectoryHandle, path: string): Promise<T | null> {
  let file: FileSystemFileHandle
  try { file = await handle(root, path) }
  catch (error) { if (error instanceof DOMException && error.name === "NotFoundError") return null; throw error }
  try { return JSON.parse(await (await file.getFile()).text()) as T }
  catch { throw new Error("La caché de PDF está dañada; no se reemplazó su contenido.") }
}
export async function readPdfCrop(root: FileSystemDirectoryHandle, path: string): Promise<File | null> {
  try { return await (await handle(root, path)).getFile() }
  catch (error) { if (error instanceof DOMException && error.name === "NotFoundError") return null; throw error }
}
export async function writePdfCrop(root: FileSystemDirectoryHandle, path: string, blob: Blob) {
  const file = await handle(root, path, true), writer = await file.createWritable()
  try { await writer.write(blob); await writer.close() } catch (error) { await writer.abort().catch(() => {}); throw error }
  if ((await file.getFile()).size !== blob.size) throw new Error("No se pudo verificar el recorte guardado.")
}
export async function writePdfCache(root: FileSystemDirectoryHandle, path: string, value: unknown) {
  const text = JSON.stringify(value)
  const file = await handle(root, path, true)
  // Keep the previous valid contents available if a write is interrupted.
  const previous = await file.getFile().then((file) => file.text()).catch(() => "")
  if (previous) {
    const backup = await handle(root, path + ".backup", true)
    const writer = await backup.createWritable()
    try { await writer.write(previous); await writer.close() } catch (error) { await writer.abort().catch(() => {}); throw error }
  }
  const writer = await file.createWritable()
  try { await writer.write(text); await writer.close() } catch (error) { await writer.abort().catch(() => {}); throw error }
  if (await (await file.getFile()).text() !== text) throw new Error("No se pudo verificar la caché guardada.")
}
const queues = new WeakMap<FileSystemDirectoryHandle, Map<string, Promise<unknown>>>()
export async function inPdfCacheQueue<T>(root: FileSystemDirectoryHandle, key: string, action: () => Promise<T>): Promise<T> {
  let queue = queues.get(root)
  if (!queue) { queue = new Map(); queues.set(root, queue) }
  const previous = queue.get(key) ?? Promise.resolve()
  const pending = previous.catch(() => {}).then(() => typeof navigator !== "undefined" && navigator.locks
    ? navigator.locks.request(`subject-pdf-cache:${key}`, action) : action())
  queue.set(key, pending)
  try { return await pending } finally { if (queue.get(key) === pending) queue.delete(key) }
}
