"use client"

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react"
import { SubjectImageBubble } from "./subject-image-bubble"
import { isDiscarded, type DiscardEntry } from "@/lib/client/subject-discard-history"
import { loadWeekTopics, saveWeekTopics, readWeekTopicImage, type WeekTopics } from "@/lib/client/subject-week-topics"
import type { VoiceImage } from "@/lib/subject-voice-images"

export type WeekTopicsHandle = { receive: (files: File[]) => Promise<void>; choose: () => void; escape: () => boolean; blocksInput: () => boolean }
export function SubjectWeekTopics({ subjectId, weekNumber, ref, onBusy, onViewing, history, historyReady, remove }: {
  subjectId: string; weekNumber: number; ref?: Ref<WeekTopicsHandle>; onBusy: (busy: boolean) => void; onViewing: (viewing: boolean) => void; history: DiscardEntry[]; historyReady: boolean; remove: (image: VoiceImage) => Promise<void>
}) {
  const [workspace,setWorkspace] = useState<WeekTopics | null>(null)
  const [error,setError] = useState("")
  const [busy,setBusy] = useState(false)
  const [retry,setRetry] = useState<File[] | null>(null)
  const [viewer,setViewer] = useState<{image:VoiceImage;url:string} | null>(null)
  const [attempt,setAttempt] = useState(0)
  const input = useRef<HTMLInputElement>(null), alive = useRef(true), locked = useRef(false)
  const mutation = useRef(0)
  useEffect(() => {
    alive.current = true
    let disposed = false
    const currentMutation = mutation.current
    setError("")
    void loadWeekTopics(subjectId,weekNumber).then(next => {if (!disposed && mutation.current === currentMutation) setWorkspace(next)})
      .catch(failure => {if (!disposed) setError(message(failure))})
    return () => {disposed=true;alive.current=false}
  },[subjectId,weekNumber,attempt])
  useEffect(() => () => {if (viewer) URL.revokeObjectURL(viewer.url)},[viewer])
  useEffect(() => {onViewing(Boolean(viewer));return () => onViewing(false)},[viewer,onViewing])
  function message(failure:unknown) {return failure instanceof Error ? failure.message : "No se pudo completar la operación."}
  function choose() {input.current?.click()}
  async function receive(files:File[]) {
    if (locked.current || viewer) return
    mutation.current++
    locked.current=true;setBusy(true);onBusy(true);setError("");setRetry(null)
    try {
      const next = await saveWeekTopics(subjectId,weekNumber,files)
      if (!alive.current) return
      setWorkspace(next.workspace);setError(next.errors.join("\n"));setRetry(next.failed.length ? next.failed : null)
    } catch (failure) {if (alive.current) {setError(message(failure));setRetry(files)}}
    finally {locked.current=false;if (alive.current) {setBusy(false);onBusy(false)}}
  }
  async function open(image:VoiceImage) {
    if (locked.current) return
    locked.current=true;setBusy(true);onBusy(true);setError("")
    try {
      const file = await readWeekTopicImage(subjectId,weekNumber,image)
      if (alive.current) setViewer({image,url:URL.createObjectURL(file)})
    } catch (failure) {if (alive.current) setError(message(failure))}
    finally {locked.current=false;if (alive.current) {setBusy(false);onBusy(false)}}
  }
  useImperativeHandle(ref,() => ({receive,choose,blocksInput:()=>locked.current || Boolean(viewer),escape:()=>{
    if (locked.current) return true
    if (viewer) {setViewer(null);return true}
    return false
  }}),[viewer,subjectId,weekNumber,onBusy])
  return <section className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 pt-28 pb-24 sm:px-8 sm:pt-32" data-week-topics
    onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();event.stopPropagation();void receive(Array.from(event.dataTransfer.files))}}>
    <input ref={input} type="file" accept="image/*" multiple className="hidden" aria-label="Seleccionar imágenes para temas"
      onChange={event=>{const files=Array.from(event.target.files??[]);event.target.value="";void receive(files)}} />
    <p className="text-center text-sm text-neutral-500">Síntesis manual · Semana {weekNumber}</p>
    {viewer ? <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={viewer.url} alt={viewer.image.name} draggable={false} className="min-h-0 w-full flex-1 object-contain"
        onError={()=>setError("No se pudo mostrar esta imagen. Volvé a Temas y reintentá.")} />
    </> : <>
      {workspace && !workspace.images.length && <button type="button" disabled={busy} onClick={choose} className="flex min-h-48 flex-1 items-center justify-center text-center text-xl">
        Arrastrá imágenes para la síntesis de esta semana o tocá aquí para subirlas.
      </button>}
      {!workspace && !error && <p role="status">Cargando temas…</p>}
      <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
        {historyReady && workspace?.images.filter(image => !isDiscarded(history, `topics:${weekNumber}`, "topic", image.id)).map(image => <SubjectImageBubble key={image.id} image={image} topic color="#ffec99" disabled={busy}
          open={() => void open(image)} remove={() => remove(image)} failed={failure => setError(message(failure))} />)}
      </div>
    </>}
    {busy && <p role="status">Procesando imágenes…</p>}
    {error && <div><p role="alert" className="whitespace-pre-wrap">{error}</p>
      <button type="button" disabled={busy} className="mt-2 rounded-lg border px-4 py-2" onClick={()=>retry ? void receive(retry) : setAttempt(value=>value+1)}>Reintentar temas</button>
    </div>}
  </section>
}
