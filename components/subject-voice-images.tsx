"use client"

import { useEffect, useImperativeHandle, useRef, useState, type DragEvent, type Ref } from "react"
import { HandDrawnBubble } from "@/components/hand-drawn-bubble"
import { loadVoiceImageGroups, readVoiceImage, saveVoiceImages, validateVoiceImageFiles, VOICE_IMAGE_COLORS, type VoiceImage, type VoiceImageWorkspace } from "@/lib/subject-voice-images"

export type VoiceImagesHandle = { escape: () => boolean }
type Target = { groupId: string } | { name: string; color: string }
const control = "rounded-lg border border-neutral-300 px-4 py-2 text-base hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-black disabled:opacity-50"
const colorNames = ["Verde", "Azul", "Amarillo", "Rosa", "Violeta", "Naranja"]

export function SubjectVoiceImages({ subjectId, ref }: { subjectId: string; ref?: Ref<VoiceImagesHandle> }) {
  const [workspace, setWorkspace] = useState<VoiceImageWorkspace | null>(null)
  const [groupId, setGroupId] = useState<string | null>(null)
  const [pending, setPending] = useState<File[] | null>(null)
  const [name, setName] = useState("")
  const [color, setColor] = useState<string>(VOICE_IMAGE_COLORS[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [retry, setRetry] = useState<{ files: File[]; target: Target } | null>(null)
  const [viewer, setViewer] = useState<{ image: VoiceImage; url: string } | null>(null)
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const inputTarget = useRef<string | null>(null)
  const locked = useRef(false)
  const mounted = useRef(true)
  const group = workspace?.groups.find((item) => item.id === groupId)

  async function refresh() {
    setError("")
    try { const next = await loadVoiceImageGroups(subjectId); if (mounted.current) setWorkspace(next) }
    catch (failure) { if (mounted.current) setError(message(failure)) }
  }

  useEffect(() => {
    mounted.current = true
    void refresh()
    return () => { mounted.current = false }
    // The parent keys this component by subject, so pending files never cross subjects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectId])

  useEffect(() => () => { if (viewer) URL.revokeObjectURL(viewer.url) }, [viewer])

  useImperativeHandle(ref, () => ({ escape: () => {
    if (busy) return true
    if (viewer) { setViewer(null); return true }
    if (pending) { setPending(null); setRetry(null); setError(""); return true }
    return false
  } }), [busy, viewer, pending])

  function message(failure: unknown) { return failure instanceof Error ? failure.message : "No se pudo completar la operación." }

  async function save(files: File[], target: Target, notices: string[] = []) {
    setRetry(null)
    try {
      const result = await saveVoiceImages(subjectId, files, target)
      if (!mounted.current) return
      setWorkspace(result.workspace)
      if (result.workspace.groups.some((item) => item.id === result.groupId) && "name" in target) setGroupId(null)
      setPending(null)
      setError([...notices, ...result.errors].join("\n"))
      if (result.failed.length) setRetry({ files: result.failed, target: result.workspace.groups.some((item) => item.id === result.groupId) ? { groupId: result.groupId } : target })
    } catch (failure) {
      if (!mounted.current) return
      setError([...notices, message(failure)].join("\n"))
      setRetry({ files, target })
    }
  }

  async function receive(files: File[], targetGroup: string | null) {
    if (locked.current || !workspace || pending || viewer) return
    locked.current = true
    setBusy(true)
    setError("")
    setRetry(null)
    try {
      const { valid, rejected } = await validateVoiceImageFiles(files)
      if (!mounted.current) return
      setError(rejected.join("\n"))
      if (!valid.length) return
      if (targetGroup) await save(valid, { groupId: targetGroup }, rejected)
      else { setPending(valid); setName(""); setColor(VOICE_IMAGE_COLORS[0]) }
    } catch (failure) { if (mounted.current) setError(message(failure)) }
    finally { locked.current = false; if (mounted.current) setBusy(false) }
  }

  function drop(event: DragEvent, targetGroup: string | null) {
    event.preventDefault()
    event.stopPropagation()
    setDragging(false)
    void receive(Array.from(event.dataTransfer.files), targetGroup)
  }

  function choose(targetGroup: string | null) {
    inputTarget.current = targetGroup
    input.current?.click()
  }

  async function runSave(files: File[], target: Target, notices: string[] = []) {
    if (locked.current) return
    locked.current = true
    setBusy(true)
    setError("")
    await save(files, target, notices)
    locked.current = false
    if (mounted.current) setBusy(false)
  }

  async function openImage(image: VoiceImage) {
    if (locked.current) return
    locked.current = true
    setBusy(true)
    setError("")
    try {
      const file = await readVoiceImage(subjectId, image)
      if (mounted.current) setViewer({ image, url: URL.createObjectURL(file) })
    } catch (failure) { if (mounted.current) setError(`No se pudo abrir ${image.name}: ${message(failure)}`) }
    finally { locked.current = false; if (mounted.current) setBusy(false) }
  }

  return <div className={`relative flex min-h-0 flex-1 flex-col ${dragging ? "bg-green-50" : ""}`}
    onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = busy || pending || viewer ? "none" : "copy" }}
    onDragEnter={(event) => { if (event.dataTransfer.types.includes("Files")) setDragging(true) }}
    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false) }}
    onDrop={(event) => drop(event, null)} data-subject-voice-images>
    <input ref={input} type="file" accept="image/*" multiple className="hidden" aria-label="Seleccionar imágenes"
      onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void receive(files, inputTarget.current) }} />

    {!workspace && <div className="flex flex-1 items-center justify-center text-xl">{error ? "No se pudieron cargar los conjuntos." : "Cargando conjuntos…"}</div>}

    {workspace && pending && <form className="mx-auto flex min-h-0 w-full max-w-lg flex-1 flex-col gap-5 overflow-y-auto py-8" aria-label="Crear conjunto"
      onSubmit={(event) => { event.preventDefault(); if (name.trim()) void runSave(pending, { name, color }, retry ? [] : error ? [error] : []) }}>
      <p className="text-2xl">Nombre para el conjunto de {pending.length} imágenes</p>
      <label className="flex flex-col gap-2">Nombre del conjunto
        <input autoFocus required value={name} disabled={busy} onChange={(event) => setName(event.target.value)} className="rounded-lg border border-neutral-400 px-4 py-3 text-xl" />
      </label>
      <fieldset disabled={busy}><legend className="mb-3">Color del conjunto</legend>
        <div className="flex flex-wrap gap-3">{VOICE_IMAGE_COLORS.map((value, index) => <label key={value} className="flex cursor-pointer flex-col items-center gap-1 text-sm">
          <input type="radio" name="group-color" value={value} checked={color === value} onChange={() => setColor(value)} aria-label={colorNames[index]} className="peer sr-only" />
          <span style={{ backgroundColor: value }} className="h-10 w-10 rounded-full border border-black peer-checked:ring-2 peer-checked:ring-black peer-checked:ring-offset-2 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4" />
          {colorNames[index]}
        </label>)}</div>
      </fieldset>
      <div className="flex gap-3"><button type="submit" className={control} disabled={busy || !name.trim()}>Crear conjunto</button>
        <button type="button" className={control} disabled={busy} onClick={() => { setPending(null); setRetry(null); setError("") }}>Cancelar</button></div>
    </form>}

    {workspace && !pending && viewer && <div className="flex min-h-0 flex-1 flex-col gap-4 py-4">
      <div className="flex flex-wrap items-center gap-3"><button autoFocus className={control} onClick={() => setViewer(null)}>Volver al conjunto</button>
        <button className={control} onClick={() => { setViewer(null); setGroupId(null) }}>Ver conjuntos</button><span className="break-all">{viewer.image.name}</span></div>
      {/* Original local image; next/image cannot optimize object URLs. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={viewer.url} alt={viewer.image.name} className="min-h-0 w-full flex-1 object-contain" onError={() => { setError(`No se pudo mostrar ${viewer.image.name}. Volvé al conjunto e intentá abrirla otra vez.`) }} />
    </div>}

    {workspace && !pending && !viewer && <>
      {workspace.groups.length === 0 ? <button type="button" disabled={busy} onClick={() => choose(null)} className="flex min-h-48 flex-1 flex-col items-center justify-center gap-2 px-2 py-10 text-center text-xl leading-relaxed sm:text-2xl">
        <span>Arrastrá imágenes con su nombre y extensión</span><span>Elegí un nombre y un color para el conjunto</span><span>O tocá aquí para seleccionarlas</span>
      </button> : <div className="min-h-0 flex-1 overflow-y-auto py-5" data-voice-bubbles>
        {group && <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
          <button className={control} disabled={busy} onClick={() => setGroupId(null)}>Volver a conjuntos</button>
          <HandDrawnBubble seed={group.id} color={group.color} className="min-h-24 max-w-64 text-xl" disabled={busy} onClick={() => choose(group.id)} onDrop={(event) => drop(event, group.id)} aria-label={`Agregar imágenes a ${group.name}`}>{group.name}</HandDrawnBubble>
          <button className={control} disabled={busy} onClick={() => choose(group.id)}>Agregar imágenes</button>
        </div>}
        <div className={group || workspace.groups.length > 1 ? "grid grid-cols-1 items-start gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3" : "flex h-full min-h-40 items-center justify-center"}>
          {group ? group.images.map((image) => <HandDrawnBubble key={image.id} seed={image.id} color={group.color} disabled={busy} onClick={() => void openImage(image)}>{image.name.replace(/\.[^.]+$/, "") || image.name}</HandDrawnBubble>)
            : workspace.groups.map((item) => <HandDrawnBubble key={item.id} seed={item.id} color={item.color} disabled={busy}
              className={workspace.groups.length === 1 ? "h-full min-h-40 max-h-80 max-w-xl py-8" : "min-h-48"}
              onClick={() => setGroupId(item.id)} onDrop={(event) => drop(event, item.id)} aria-label={`${item.name}, ${item.images.length} imágenes`}>
              <span className="block">{item.name}</span><span className="mt-3 block text-5xl sm:text-6xl">{item.images.length}</span>
            </HandDrawnBubble>)}
        </div>
      </div>}
      {workspace.groups.length > 0 && <div className="flex shrink-0 items-center justify-center gap-3 py-3 text-center text-sm sm:text-base">
        <span>Soltá sobre un conjunto para agregar, o en blanco para crear otro.</span><button className={control} disabled={busy} onClick={() => choose(null)}>Nuevo conjunto</button>
      </div>}
    </>}
    {busy && <p role="status" className="shrink-0 py-2 text-center">Procesando imágenes…</p>}
    {error && <div className="max-h-36 shrink-0 overflow-y-auto py-3 text-base">
      <p role="alert" className="whitespace-pre-wrap">{error}</p>
      {!workspace && <button className={control} onClick={() => void refresh()}>Reintentar carga</button>}
      {retry && <button className={control} disabled={busy} onClick={() => void runSave(retry.files, retry.target)}>Reintentar guardado</button>}
    </div>}
  </div>
}
