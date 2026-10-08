"use client"

import { useEffect, useImperativeHandle, useMemo, useRef, useState, type DragEvent, type Ref } from "react"
import { HandDrawnBubble } from "@/components/hand-drawn-bubble"
import { loadVoiceImageGroups, readVoiceImage, regroupVoiceImages, saveVoiceImages, validateVoiceImageFiles, VOICE_IMAGE_COLORS, type VoiceImage, type VoiceImageWorkspace } from "@/lib/subject-voice-images"
import { isManualTopicsQuery, searchVoiceImages, voiceGroupDiameter, voiceImageName } from "@/lib/subject-voice-search"
import { getCurrentWeekNumber } from "@/lib/subject-utils"
import { SubjectWeekTopics, type WeekTopicsHandle } from "@/components/subject-week-topics"
import { useSubjectPdfSearch } from "@/hooks/use-subject-pdf-search"
import { SubjectPdfViewPool } from "@/components/subject-pdf-view-pool"
import { SubjectPdfBubble } from "@/components/subject-pdf-bubble"
import type { PdfSearchResult } from "@/lib/subject-pdf-search"
import { SubjectImageBubble } from "@/components/subject-image-bubble"
import { discardItem, undoDiscard, loadDiscardHistory, isDiscarded, queryDiscardScope, pdfDiscardId, type DiscardEntry } from "@/lib/client/subject-discard-history"
import { normalizePdfQuery } from "@/lib/subject-pdf-search"
import { LoaderCircle } from "lucide-react"

export type VoiceImagesHandle = { escape: () => boolean; dictate: (final: string, interim: string) => void }
type Target = { groupId: string } | { name: string; color: string }
const control = "rounded-lg border border-neutral-300 px-4 py-2 text-base hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-black disabled:opacity-50"
const colorNames = ["Verde", "Azul", "Amarillo", "Rosa", "Violeta", "Naranja"]

export function SubjectVoiceImages({ subjectId, weekNumber = getCurrentWeekNumber(), ref, onPdfViewing }: { subjectId: string; weekNumber?: number; ref?: Ref<VoiceImagesHandle>; onPdfViewing?: (viewing: boolean) => void }) {
  const [workspace, setWorkspace] = useState<VoiceImageWorkspace | null>(null)
  const [groupId, setGroupId] = useState<string | null>(null)
  const [pending, setPending] = useState<File[] | null>(null)
  const [selection, setSelection] = useState<{ images: VoiceImage[]; pdfs: PdfSearchResult[]; destinationId: string } | null>(null)
  const [query, setQuery] = useState("")
  const queryValue = useRef(query)
  queryValue.current = query
  const dictated = useRef<{start: number; text: string} | null>(null)
  const editedDictation = useRef(false)
  const manualTopics = isManualTopicsQuery(query)
  const topicsRef = useRef<WeekTopicsHandle>(null)
  const [topicsViewing, setTopicsViewing] = useState(false)
  const pdf = useSubjectPdfSearch(subjectId, query)
  const [history, setHistory] = useState<DiscardEntry[]>([])
  const [historyReady, setHistoryReady] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const historyRevision = useRef(0)
  const [pdfViewer, setPdfViewer] = useState<PdfSearchResult | null>(null)
  const [name, setName] = useState("")
  const [color, setColor] = useState<string>(VOICE_IMAGE_COLORS[0])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [retry, setRetry] = useState<{ files: File[]; target: Target } | null>(null)
  const [viewer, setViewer] = useState<{ image: VoiceImage; url: string } | null>(null)
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const inputTarget = useRef<string | null>(null)
  const searchInput = useRef<HTMLInputElement>(null)
  const canvas = useRef<HTMLDivElement>(null)
  const locked = useRef(false)
  const mounted = useRef(true)
  const group = workspace?.groups.find((item) => item.id === groupId)
  const searching = Boolean(query.trim())
  const scope = manualTopics ? `topics:${weekNumber}` : searching ? queryDiscardScope(query) : `group:${groupId}`
  const matches = useMemo(() => searchVoiceImages(workspace?.groups ?? [], query).filter(({ image }) =>
    !isDiscarded(history, scope, "image", image.id)), [workspace, query, history, scope])
  const visiblePdfs = pdf.results.filter(result => !isDiscarded(history, queryDiscardScope(result.query), "pdf", pdfDiscardId(result)))
  const undoScopes = searching && !manualTopics ? [...new Set([scope, ...history.filter(entry => entry.kind === "pdf" && entry.scope.startsWith("query:") &&
    entry.result?.query.startsWith(normalizePdfQuery(query))).map(entry => entry.scope)])] : [scope]
  const visibleGroupCount = (item: NonNullable<VoiceImageWorkspace["groups"]>[number]) =>
    item.images.filter(image => !isDiscarded(history, `group:${item.id}`, "image", image.id)).length +
    (item.pdfs ?? []).filter(result => !isDiscarded(history, `group:${item.id}`, "pdf", pdfDiscardId(result))).length
  const formOpen = pending !== null || selection !== null
  const pdfViewing = Boolean(pdfViewer && workspace && !formOpen)
  useEffect(() => {
    onPdfViewing?.(pdfViewing)
    return () => onPdfViewing?.(false)
  }, [pdfViewing, onPdfViewing])

  useEffect(() => {
    let disposed = false
    const revision = historyRevision.current
    void loadDiscardHistory(subjectId).then(entries => {
      if (!disposed && revision === historyRevision.current) { setHistory(entries); setHistoryReady(true) }
    }).catch(failure => { if (!disposed) setError(message(failure)) })
    return () => { disposed = true }
  }, [subjectId, pdf.preparing, pdf.searching, pdf.results])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 5000)
    return () => window.clearTimeout(timer)
  }, [notice])
  async function removeItem(item: Omit<DiscardEntry, "id" | "undone">) {
    if (locked.current || !historyReady) return
    locked.current = true; setBusy(true); setError(""); historyRevision.current++
    try {
      const entries = await discardItem(subjectId, item)
      if (mounted.current) { setHistory(entries); setNotice(entries.findLast(entry => !entry.undone && entry.scope === item.scope && entry.itemId === item.itemId)?.id ?? null) }
    } finally { locked.current = false; if (mounted.current) setBusy(false) }
  }
  async function undo(entryId?: string) {
    if (locked.current || !historyReady) return
    locked.current = true; setBusy(true); setError(""); historyRevision.current++
    try {
      const entries = await undoDiscard(subjectId, undoScopes, entryId)
      if (mounted.current) {
        if (entries.some(entry => entry.legacy && entry.undone && history.some(previous => previous.id === entry.id && !previous.undone))) pdf.retry()
        setHistory(entries); setNotice(null)
      }
    } catch (failure) { if (mounted.current) setError(message(failure)) }
    finally { locked.current = false; if (mounted.current) setBusy(false) }
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.shiftKey || event.altKey || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z" || formOpen) return
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]") && event.target !== searchInput.current) return
      event.preventDefault(); void undo()
    }
    window.addEventListener("keydown", key)
    return () => window.removeEventListener("keydown", key)
  })

  function focusCanvas() { canvas.current?.focus() }
  function cancelForm() { setPending(null); setSelection(null); setRetry(null); setError(""); focusCanvas() }

  useEffect(() => {
    const capture = (event: KeyboardEvent) => {
      if (!workspace || formOpen || viewer || pdfViewer || (manualTopics && topicsRef.current?.blocksInput()) || locked.current || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.isComposing || event.key.length !== 1) return
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]")) return
      if (event.key === " " && event.target instanceof Element && event.target.closest("button")) return
      event.preventDefault()
      setQuery((previous) => previous + event.key)
      searchInput.current?.focus()
    }
    window.addEventListener("keydown", capture)
    return () => window.removeEventListener("keydown", capture)
  }, [workspace, formOpen, viewer, pdfViewer, manualTopics])

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

  useImperativeHandle(ref, () => ({ dictate: (final, interim) => {
    if (formOpen || viewer || pdfViewer || locked.current) return
    if (editedDictation.current) {
      if (!final && interim) return
      editedDictation.current = false
      final = ""
    }
    const previous = queryValue.current
    const pending = dictated.current
    const valid = pending && previous.slice(pending.start, pending.start + pending.text.length) === pending.text
    const cursor = valid ? pending.start : document.activeElement === searchInput.current ? searchInput.current?.selectionStart ?? previous.length : previous.length
    const head = previous.slice(0, cursor), tail = previous.slice(cursor + (valid ? pending.text.length : 0))
    const prefix = head && !/\s$/.test(head) ? " " : ""
    const confirmed = final ? prefix + final : ""
    const temporary = interim ? (final ? " " : prefix) + interim : ""
    const separator = (confirmed || temporary) && tail && !/^\s/.test(tail) ? " " : ""
    const next = head + confirmed + temporary + separator + tail
    dictated.current = temporary ? { start: head.length + confirmed.length, text: temporary + separator } : null
    queryValue.current = next
    setQuery(next)
    if (document.activeElement === searchInput.current) queueMicrotask(() => searchInput.current?.setSelectionRange(head.length + confirmed.length + temporary.length, head.length + confirmed.length + temporary.length))
  }, escape: () => {
    if (locked.current) return true
    if (manualTopics && topicsRef.current?.escape()) { focusCanvas(); return true }
    if (pdfViewer) { setPdfViewer(null); focusCanvas(); return true }
    if (viewer) { setViewer(null); focusCanvas(); return true }
    if (formOpen) { cancelForm(); return true }
    if (query.length) { setQuery(""); focusCanvas(); return true }
    if (groupId) { setGroupId(null); focusCanvas(); return true }
    return false
  } }), [viewer, pdfViewer, formOpen, query, groupId, manualTopics])

  function message(failure: unknown) { return failure instanceof Error ? failure.message : "No se pudo completar la operación." }

  async function save(files: File[], target: Target, notices: string[] = []) {
    setRetry(null)
    try {
      const result = await saveVoiceImages(subjectId, files, target)
      if (!mounted.current) return
      setWorkspace(result.workspace)
      if (result.workspace.groups.some((item) => item.id === result.groupId) && "name" in target) { setGroupId(null); setQuery("") }
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
    if (manualTopics) { await topicsRef.current?.receive(files); return }
    if (locked.current || !workspace || formOpen || viewer || pdfViewer) return
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

  function newGroup() {
    if (locked.current || formOpen || viewer || pdfViewer) return
    if (manualTopics) { if (!topicsRef.current?.blocksInput()) topicsRef.current?.choose(); return }
    if (!searching) { choose(null); return }
    if (!matches.length && !visiblePdfs.length) return
    setSelection({ images: matches.map((match) => match.image), pdfs: structuredClone(visiblePdfs), destinationId: crypto.randomUUID() })
    setName(query.trim())
    setColor(VOICE_IMAGE_COLORS[0])
    setRetry(null)
    setError("")
  }

  async function runRegroup() {
    if (!selection || !name.trim() || locked.current) return
    locked.current = true
    setBusy(true)
    setError("")
    try {
      const next = await regroupVoiceImages(subjectId, selection.images.map((image) => image.id), { id: selection.destinationId, name, color }, selection.pdfs)
      if (!mounted.current) return
      setWorkspace(next)
      setSelection(null)
      setQuery("")
      setGroupId(null)
      focusCanvas()
    } catch (failure) { if (mounted.current) setError(message(failure)) }
    finally { locked.current = false; if (mounted.current) setBusy(false) }
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
      if (mounted.current) { setViewer({ image, url: URL.createObjectURL(file) }); focusCanvas() }
    } catch (failure) { if (mounted.current) setError(`No se pudo abrir ${image.name}: ${message(failure)}`) }
    finally { locked.current = false; if (mounted.current) setBusy(false) }
  }

  return <div ref={canvas} tabIndex={-1} className={`relative flex min-h-0 flex-1 flex-col outline-none ${dragging ? "bg-green-50" : ""}`}
    onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = busy || formOpen || viewer ? "none" : "copy" }}
    onDragEnter={(event) => { if (!manualTopics && event.dataTransfer.types.includes("Files")) setDragging(true) }}
    onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false) }}
    onDrop={(event) => drop(event, null)} data-subject-voice-images>
    <input ref={input} type="file" accept="image/*" multiple className="hidden" aria-label="Seleccionar imágenes"
      onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void receive(files, inputTarget.current) }} />

    {!workspace && <div className="flex flex-1 items-center justify-center text-xl">{error ? "No se pudieron cargar los conjuntos." : "Cargando conjuntos…"}</div>}

    {workspace && formOpen && <form className="mx-auto flex min-h-0 w-full max-w-lg flex-1 flex-col gap-5 overflow-y-auto px-5 pt-28 pb-8 sm:pt-32" aria-label="Crear conjunto"
      onSubmit={(event) => { event.preventDefault(); if (selection) void runRegroup(); else if (pending && name.trim()) void runSave(pending, { name, color }, retry ? [] : error ? [error] : []) }}>
      <p className="text-2xl">Nombre para el conjunto de {selection ? selection.images.length + selection.pdfs.length : pending?.length} {selection?.pdfs.length ? "elementos" : "imágenes"}</p>
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
        <button type="button" className={control} disabled={busy} onClick={cancelForm}>Cancelar</button></div>
    </form>}

    {workspace && !formOpen && viewer && <div className="flex min-h-0 flex-1 flex-col py-4">
      {/* Original local image; next/image cannot optimize object URLs. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={viewer.url} alt={viewer.image.name} className="min-h-0 w-full flex-1 object-contain" onError={() => { setError(`No se pudo mostrar ${viewer.image.name}. Volvé al conjunto e intentá abrirla otra vez.`) }} />
    </div>}

    {workspace && <SubjectPdfViewPool candidates={formOpen || manualTopics ? [] : searching ? visiblePdfs : (group?.pdfs ?? []).filter(result => !isDiscarded(history, scope, "pdf", pdfDiscardId(result)))} active={formOpen ? null : pdfViewer} subjectId={subjectId}
      onBack={() => { setPdfViewer(null); focusCanvas() }} onUndo={() => void undo()}
      onSearchAgain={() => { setPdfViewer(null); pdf.retry(); focusCanvas() }} />}

    {workspace && !formOpen && !viewer && !pdfViewer && <>
      {manualTopics ? <SubjectWeekTopics key={`${subjectId}:${weekNumber}`} subjectId={subjectId} weekNumber={weekNumber}
        ref={topicsRef} onBusy={setBusy} onViewing={setTopicsViewing} history={history} historyReady={historyReady}
        remove={image => removeItem({ scope: `topics:${weekNumber}`, kind: "topic", itemId: image.id })} /> : <>
      {workspace.groups.length === 0 && !searching ? <button type="button" disabled={busy} onClick={() => choose(null)} className="flex min-h-48 flex-1 flex-col items-center justify-center gap-2 px-2 py-10 text-center text-xl leading-relaxed sm:text-2xl">
        <span>Arrastrá imágenes con su nombre y extensión</span><span>Elegí un nombre y un color para el conjunto</span><span>O tocá aquí para seleccionarlas</span>
      </button> : <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-28 pb-24 sm:px-8 sm:pt-32" data-voice-bubbles>
        {searching && matches.length === 0 && visiblePdfs.length === 0 && !pdf.searching && !pdf.preparing && !pdf.errors.length && <p role="status" className="py-10 text-center text-xl">Sin coincidencias</p>}
        <div className={searching || group ? "grid grid-cols-1 items-start gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3" : "flex flex-wrap items-center justify-center gap-10"}>
          {searching ? matches.map(({ image, group: source }) => <SubjectImageBubble key={image.id} image={image} color={source.color} disabled={busy || !historyReady}
            open={() => void openImage(image)} remove={() => removeItem({ scope, kind: "image", itemId: image.id })} failed={failure => setError(message(failure))} />)
            : group ? group.images.filter(image => !isDiscarded(history, scope, "image", image.id)).map(image => <SubjectImageBubble key={image.id} image={image} color={group.color} disabled={busy || !historyReady}
              open={() => void openImage(image)} remove={() => removeItem({ scope, kind: "image", itemId: image.id })} failed={failure => setError(message(failure))} />)
            : workspace.groups.map((item) => <HandDrawnBubble key={item.id} seed={item.id} color={item.color} disabled={busy}
              className="aspect-square min-h-0 max-w-full shrink-0 px-5 py-5"
              style={{ width: voiceGroupDiameter(visibleGroupCount(item)), fontSize: Math.min(28, voiceGroupDiameter(visibleGroupCount(item)) / 8) }}
              onClick={() => setGroupId(item.id)} onDrop={(event) => drop(event, item.id)} aria-label={`${item.name}, ${visibleGroupCount(item)} ${item.pdfs?.length ? "elementos" : "imágenes"}`}>
              <span className="block">{item.name}</span><span className="mt-3 block text-5xl sm:text-6xl">{visibleGroupCount(item)}</span>
            </HandDrawnBubble>)}
          {searching && historyReady && visiblePdfs.map(result => <SubjectPdfBubble key={result.id} result={result}
            disabled={busy} open={() => { setPdfViewer(result); focusCanvas() }} removed={() => {}}
            remove={() => removeItem({ scope: queryDiscardScope(result.query), kind: "pdf", itemId: pdfDiscardId(result), result })}
            failed={failure => setError(message(failure))} />)}
          {!searching && historyReady && group?.pdfs?.filter(result => !isDiscarded(history, scope, "pdf", pdfDiscardId(result))).map(result => <SubjectPdfBubble key={result.id} result={result} disabled={busy} color={group.color}
            open={() => { setPdfViewer(result); focusCanvas() }} removed={() => {}}
            remove={() => removeItem({ scope, kind: "pdf", itemId: pdfDiscardId(result), result })} failed={failure => setError(message(failure))} />)}
        </div>
      </div>}
      </>}
      {!topicsViewing &&
      <div className="pointer-events-none absolute inset-x-5 bottom-5 z-30 flex min-h-12 items-center justify-center sm:inset-x-8 sm:bottom-8" data-voice-floating-controls>
        <div className="pointer-events-auto inline-grid min-w-[3ch] max-w-[calc(100%_-_8rem)] rounded-lg bg-white/95">
        <span aria-hidden="true" className="invisible col-start-1 row-start-1 overflow-hidden px-3 py-2 text-2xl whitespace-pre">{query || " "}</span>
        <input ref={searchInput} type="text" value={query} onChange={(event) => {
          if (dictated.current) editedDictation.current = true
          dictated.current = null
          queryValue.current = event.target.value
          setQuery(event.target.value)
        }} aria-label="Buscar imágenes y PDF" data-voice-search
          size={1} autoComplete="off" spellCheck={false} disabled={busy} className="col-start-1 row-start-1 w-full min-w-0 border-0 bg-transparent px-3 py-2 text-center text-2xl outline-none focus-visible:underline focus-visible:decoration-neutral-300 focus-visible:underline-offset-8" />
        </div>
        <button type="button" onClick={newGroup} disabled={busy || (!manualTopics && searching && (pdf.searching || pdf.preparing || matches.length + visiblePdfs.length === 0))} aria-label={manualTopics ? "Subir imágenes de temas" : "Nuevo conjunto"} title={manualTopics ? "Subir imágenes de temas" : "Nuevo conjunto"}
          className="pointer-events-auto absolute right-0 flex h-12 w-12 items-center justify-center rounded-full border-[3px] border-dotted border-[#f08c00] bg-white/95 text-3xl text-[#f08c00] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#f08c00] disabled:opacity-30">+</button>
      </div>}
    </>}
    {!manualTopics && !pdfViewer && !viewer && !formOpen && <>
      {pdf.progress && <div role="status" aria-label={`Analizando PDF ${pdf.progress.current} de ${pdf.progress.total}`} data-voice-pdf-progress
        className="absolute bottom-3 left-0 flex items-center gap-1.5 text-xs text-neutral-500">
        <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
        <span>{pdf.progress.current}/{pdf.progress.total}</span>
      </div>}
      {pdf.searching && <p role="status" className="absolute bottom-24 left-1/2 z-20 -translate-x-1/2 rounded bg-white/95 px-3 py-2 text-center text-sm">Filtrando coincidencias en los PDF…</p>}
      {pdf.errors.length > 0 && <div className="absolute bottom-24 left-5 z-40 max-h-28 max-w-[calc(100%_-_2.5rem)] overflow-y-auto rounded bg-white/95 px-3 py-2 text-sm">
        <p role="alert" className="whitespace-pre-wrap">{pdf.errors.join("\n")}</p>
        <button type="button" className={control} onClick={pdf.retry} disabled={pdf.preparing || pdf.searching}>Reintentar PDF</button>
      </div>}
    </>}
    {!manualTopics && busy && <p role="status" className="absolute bottom-24 left-5 z-40 rounded bg-white/95 px-3 py-2">Procesando imágenes…</p>}
    {notice && <div role="status" className="absolute bottom-16 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-lg bg-neutral-900 px-4 py-3 text-white" data-discard-notice>
      <span>Borrado</span>
    </div>}
    {error && <div className="absolute bottom-24 left-5 z-40 max-h-36 max-w-[calc(100%_-_2.5rem)] overflow-y-auto rounded bg-white/95 px-3 py-3 text-base">
      <p role="alert" className="whitespace-pre-wrap">{error}</p>
      {!historyReady && <button className={control} onClick={() => void loadDiscardHistory(subjectId).then(entries => { setHistory(entries); setHistoryReady(true); setError("") }).catch(failure => setError(message(failure)))}>Reintentar historial</button>}
      {!workspace && <button className={control} onClick={() => void refresh()}>Reintentar carga</button>}
      {retry && <button className={control} disabled={busy} onClick={() => void runSave(retry.files, retry.target)}>Reintentar guardado</button>}
      {selection && <button className={control} disabled={busy} onClick={() => void runRegroup()}>Reintentar guardado</button>}
    </div>}
  </div>
}
