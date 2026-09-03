"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Check, CircleAlert, Heading1, IndentDecrease, IndentIncrease, List, Loader2, Minus, Pencil, Plus, Redo2, RotateCcw, Save, Trash2, Type } from "lucide-react"
import backgroundImage from "../../sintesis/sintesis-fondo.jpg"
import { renderSynthesisMarkdown } from "@/lib/client/synthesis-markdown"
import {
  SYNTHESIS_PENDING_KEY,
  SYNTHESIS_STORAGE_KEY,
  addSynthesisNode,
  applyStructuredMarkdown,
  cleanSynthesisName,
  createEmptySynthesisTree,
  deleteSynthesisBranch,
  normalizeSynthesisTree,
  scaleSynthesisTree,
  serializeSynthesisBranch,
  synthesisChildren,
  updateSynthesisNode,
  type SynthesisSyncState,
  type SynthesisTree,
} from "@/lib/synthesis-tree"
import styles from "./sintesis.module.css"

type Conflict = { tree: SynthesisTree | null; etag: string | null }
type Draft = { x: number; y: number; value: string }
type Drag = { id: string; startX: number; startY: number; originX: number; originY: number; moved: boolean }

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `node_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
}

function readLocalTree(key: string) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null")
    if (key === SYNTHESIS_PENDING_KEY && parsed?.tree) return { tree: normalizeSynthesisTree(parsed.tree), etag: typeof parsed.etag === "string" ? parsed.etag : null }
    return parsed ? { tree: normalizeSynthesisTree(parsed), etag: null } : null
  } catch { return null }
}

function MarkdownView({ content }: { content: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (ref.current) renderSynthesisMarkdown(ref.current, content) }, [content])
  return <div ref={ref} className={styles.markdown} />
}

export function SynthesisClient() {
  const router = useRouter()
  const [tree, setTree] = useState(createEmptySynthesisTree)
  const treeRef = useRef(tree)
  const etagRef = useRef<string | null>(null)
  const editVersionRef = useRef(0)
  const savingRef = useRef<Promise<boolean> | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const [syncState, setSyncState] = useState<SynthesisSyncState>("loading")
  const [message, setMessage] = useState("")
  const [conflict, setConflict] = useState<Conflict | null>(null)
  const [currentParentId, setCurrentParentId] = useState<string | null>(null)
  const [sheetNodeId, setSheetNodeId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editorSource, setEditorSource] = useState("")
  const [draft, setDraft] = useState<Draft | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const suppressClickRef = useRef(false)
  const editorRef = useRef<HTMLTextAreaElement>(null)

  const setAcceptedTree = useCallback((nextInput: SynthesisTree, immediate = false) => {
    const next = normalizeSynthesisTree(nextInput)
    treeRef.current = next
    setTree(next)
    editVersionRef.current++
    localStorage.setItem(SYNTHESIS_STORAGE_KEY, JSON.stringify(next))
    localStorage.setItem(SYNTHESIS_PENDING_KEY, JSON.stringify({ tree: next, etag: etagRef.current }))
    setSyncState("pending")
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    if (!immediate) saveTimerRef.current = window.setTimeout(() => { void syncNowRef.current() }, 650)
    return next
  }, [])

  const syncNowRef = useRef<(force?: boolean) => Promise<boolean>>(async () => false)
  syncNowRef.current = async (force = false) => {
    if (savingRef.current) return savingRef.current
    if (!force && !localStorage.getItem(SYNTHESIS_PENDING_KEY)) return true
    const snapshot = treeRef.current
    const version = editVersionRef.current
    let encounteredConflict = false
    setSyncState("saving")
    const operation = (async () => {
      try {
        const response = await fetch("/api/inscreen/synthesis-tree", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tree: snapshot, etag: etagRef.current, force }),
          keepalive: true,
        })
        const payload = await response.json().catch(() => null)
        if (response.status === 409 && payload?.conflict) {
          encounteredConflict = true
          setConflict({ tree: payload.tree ? normalizeSynthesisTree(payload.tree) : null, etag: payload.etag ?? null })
          setSyncState("conflict")
          setMessage("Hay otra versión en R2. Tu edición continúa guardada localmente.")
          return false
        }
        if (!response.ok || !payload?.tree) throw new Error(payload?.error || "R2 no confirmó el guardado.")
        etagRef.current = payload.etag ?? null
        if (editVersionRef.current === version) {
          const confirmed = normalizeSynthesisTree(payload.tree)
          treeRef.current = confirmed
          setTree(confirmed)
          localStorage.setItem(SYNTHESIS_STORAGE_KEY, JSON.stringify(confirmed))
          localStorage.removeItem(SYNTHESIS_PENDING_KEY)
          setSyncState("saved")
          setMessage("")
        } else {
          localStorage.setItem(SYNTHESIS_PENDING_KEY, JSON.stringify({ tree: treeRef.current, etag: etagRef.current }))
          setSyncState("pending")
        }
        return true
      } catch (error) {
        setSyncState("pending")
        setMessage(error instanceof Error ? `${error.message} Los cambios quedan pendientes en este equipo.` : "Guardado pendiente en este equipo.")
        return false
      } finally {
        savingRef.current = null
        if (editVersionRef.current !== version && !encounteredConflict) window.setTimeout(() => void syncNowRef.current(), 0)
      }
    })()
    savingRef.current = operation
    return operation
  }

  useEffect(() => {
    const cached = readLocalTree(SYNTHESIS_STORAGE_KEY)
    const pending = readLocalTree(SYNTHESIS_PENDING_KEY)
    const local = pending ?? cached
    if (local) { treeRef.current = local.tree; setTree(local.tree); etagRef.current = pending?.etag ?? null }
    let cancelled = false
    void (async () => {
      try {
        const response = await fetch("/api/inscreen/synthesis-tree", { cache: "no-store" })
        const payload = await response.json().catch(() => null)
        if (!response.ok) throw new Error(payload?.error || "No se pudo abrir R2.")
        if (cancelled) return
        if (pending) {
          etagRef.current = pending.etag
          setSyncState("pending")
          void syncNowRef.current()
        } else if (payload.tree) {
          const remote = normalizeSynthesisTree(payload.tree)
          etagRef.current = payload.etag ?? null
          treeRef.current = remote; setTree(remote)
          localStorage.setItem(SYNTHESIS_STORAGE_KEY, JSON.stringify(remote))
          setSyncState("saved")
        } else if (cached && Object.keys(cached.tree.nodes).length) {
          etagRef.current = null
          setAcceptedTree(cached.tree, true)
          void syncNowRef.current()
        } else {
          etagRef.current = null
          setSyncState("saved")
        }
      } catch (error) {
        if (cancelled) return
        setSyncState(local ? "pending" : "saved")
        setMessage(error instanceof Error ? error.message : "No se pudo abrir R2.")
      }
    })()
    return () => { cancelled = true }
  }, [setAcceptedTree])

  useEffect(() => {
    const retry = () => { if (localStorage.getItem(SYNTHESIS_PENDING_KEY)) void syncNowRef.current() }
    const unload = (event: BeforeUnloadEvent) => {
      if (syncState !== "saving") return
      event.preventDefault(); event.returnValue = ""
    }
    window.addEventListener("online", retry)
    window.addEventListener("beforeunload", unload)
    return () => { window.removeEventListener("online", retry); window.removeEventListener("beforeunload", unload) }
  }, [syncState])

  const goHome = useCallback(async () => { await syncNowRef.current(); router.push("/") }, [router])
  const closeSheet = useCallback(async () => {
    await syncNowRef.current()
    setEditing(false); setSheetNodeId(null)
  }, [])

  const openEditor = (id: string) => {
    setSheetNodeId(id)
    setEditorSource(serializeSynthesisBranch(treeRef.current, id))
    setEditing(true)
    window.setTimeout(() => editorRef.current?.focus(), 0)
  }

  const saveEditor = useCallback(async () => {
    if (!sheetNodeId) return
    try {
      const next = applyStructuredMarkdown(treeRef.current, sheetNodeId, editorSource, newId)
      setAcceptedTree(next, true)
      setEditing(false)
      await syncNowRef.current()
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo aplicar el esquema.") }
  }, [editorSource, setAcceptedTree, sheetNodeId])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      if (draft) { setDraft(null); return }
      if (editing) { void saveEditor(); return }
      if (sheetNodeId) { void closeSheet(); return }
      if (currentParentId) { setCurrentParentId(treeRef.current.nodes[currentParentId]?.parentId ?? null); return }
      void goHome()
    }
    window.addEventListener("keydown", keydown)
    return () => window.removeEventListener("keydown", keydown)
  }, [closeSheet, currentParentId, draft, editing, goHome, saveEditor, sheetNodeId])

  const commitDraft = () => {
    if (!draft) return
    const name = cleanSynthesisName(draft.value)
    if (name) {
      try { setAcceptedTree(addSynthesisNode(treeRef.current, { id: newId(), parentId: currentParentId, name, x: draft.x, y: draft.y })) }
      catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo crear el elemento.") }
    }
    setDraft(null)
  }

  const changeEditorLine = (kind: "heading" | "bullet" | "text" | "indent" | "outdent") => {
    const editor = editorRef.current
    if (!editor) return
    const start = editor.selectionStart
    const lineStart = editor.value.lastIndexOf("\n", start - 1) + 1
    const lineEndCandidate = editor.value.indexOf("\n", start)
    const lineEnd = lineEndCandidate < 0 ? editor.value.length : lineEndCandidate
    const line = editor.value.slice(lineStart, lineEnd)
    let changed = line
    if (kind === "heading") changed = `# ${line.replace(/^\s*(?:#{1,6}|[-+*])\s+/, "")}`
    if (kind === "bullet") changed = `- ${line.replace(/^\s*(?:#{1,6}|[-+*])\s+/, "")}`
    if (kind === "text") changed = line.replace(/^\s*(?:#{1,6}|[-+*])\s+/, "")
    if (kind === "indent") changed = `  ${line}`
    if (kind === "outdent") changed = line.replace(/^ {1,2}/, "")
    const next = `${editor.value.slice(0, lineStart)}${changed}${editor.value.slice(lineEnd)}`
    setEditorSource(next)
    window.setTimeout(() => { editor.focus(); editor.setSelectionRange(lineStart + changed.length, lineStart + changed.length) }, 0)
  }

  const current = currentParentId ? tree.nodes[currentParentId] : null
  const nodes = synthesisChildren(tree, currentParentId)
  const sheetNode = sheetNodeId ? tree.nodes[sheetNodeId] : null
  const sheetContent = sheetNode ? serializeSynthesisBranch(tree, sheetNode.id) : ""

  const syncLabel = syncState === "loading" ? "Cargando…" : syncState === "saving" ? "Guardando…" : syncState === "saved" ? "Guardado en R2" : syncState === "conflict" ? "Conflicto" : "Pendiente para R2"

  return (
    <main className={styles.root} style={{ backgroundImage: `linear-gradient(rgba(74,30,14,.2),rgba(74,30,14,.2)), url(${backgroundImage.src})` }}>
      <header className={styles.topbar}>
        <button className={styles.backPlaque} onClick={() => {
          if (sheetNodeId) { void closeSheet(); return }
          if (currentParentId) setCurrentParentId(tree.nodes[currentParentId]?.parentId ?? null)
          else void goHome()
        }} aria-label={sheetNodeId ? "Volver al tablero" : current ? `Volver desde ${current.name}` : "Volver a la página principal"}>
          <ArrowLeft aria-hidden="true" />
        </button>
        <div className={styles.location}>
          <strong>{sheetNode?.name ?? current?.name ?? "Síntesis"}</strong>
          <span className={styles.sync} data-state={syncState}>{syncState === "saving" ? <Loader2 className={styles.spinner} /> : syncState === "saved" ? <Check /> : syncState === "conflict" ? <CircleAlert /> : <Redo2 />}{syncLabel}</span>
        </div>
        {!sheetNodeId ? <div className={styles.zoom}><button onClick={() => setAcceptedTree(scaleSynthesisTree(treeRef.current, tree.defaultScale - .1))} aria-label="Reducir elementos"><Minus /></button><button onClick={() => setAcceptedTree(scaleSynthesisTree(treeRef.current, tree.defaultScale + .1))} aria-label="Aumentar elementos"><Plus /></button></div> : null}
        {sheetNode && !editing ? <div className={styles.sheetActions}>
          <button className={styles.roundAction} onClick={() => openEditor(sheetNode.id)} aria-label="Editar contenido" title="Editar contenido"><Pencil /></button>
          <button className={styles.roundAction} onClick={() => {
            const name = window.prompt("Nuevo nombre", sheetNode.name)
            if (name !== null && cleanSynthesisName(name)) setAcceptedTree(updateSynthesisNode(treeRef.current, sheetNode.id, { name }))
          }} aria-label="Renombrar" title="Renombrar"><Type /></button>
          <button className={styles.roundAction} onClick={() => {
            if (!window.confirm(`¿Eliminar “${sheetNode.name}” y todos sus subelementos?`)) return
            setAcceptedTree(deleteSynthesisBranch(treeRef.current, sheetNode.id))
            setSheetNodeId(null); setEditing(false)
          }} aria-label="Eliminar rama" title="Eliminar rama"><Trash2 /></button>
        </div> : null}
        {editing ? <button className={styles.saveAction} onClick={() => void saveEditor()}><Save /> Guardar</button> : null}
      </header>

      {message ? <div className={styles.notice}>{message}<button onClick={() => setMessage("")} aria-label="Cerrar aviso">×</button></div> : null}
      {conflict ? <section className={styles.conflict} role="alert"><p>Tu edición local no se perdió. Elegí qué versión conservar.</p><button onClick={() => {
        const remote = conflict.tree ?? createEmptySynthesisTree(); treeRef.current = remote; setTree(remote); etagRef.current = conflict.etag
        localStorage.setItem(SYNTHESIS_STORAGE_KEY, JSON.stringify(remote)); localStorage.removeItem(SYNTHESIS_PENDING_KEY)
        setConflict(null); setSyncState("saved"); setMessage("")
      }}><RotateCcw /> Cargar R2</button><button onClick={() => { etagRef.current = conflict.etag; setConflict(null); void syncNowRef.current(true) }}><Save /> Reemplazar R2</button></section> : null}

      {sheetNode ? (
        <section className={styles.sheet}>
          {editing ? <>
            <div className={styles.editorToolbar} role="toolbar" aria-label="Estructura del texto">
              <button onClick={() => changeEditorLine("heading")} title="Título / elemento (Ctrl+Alt+1)"><Heading1 /> <span>Elemento</span></button>
              <button onClick={() => changeEditorLine("bullet")} title="Viñeta / subelemento (Ctrl+Alt+8)"><List /> <span>Subelemento</span></button>
              <button onClick={() => changeEditorLine("indent")} title="Aumentar sangría"><IndentIncrease /></button>
              <button onClick={() => changeEditorLine("outdent")} title="Reducir sangría"><IndentDecrease /></button>
              <button onClick={() => changeEditorLine("text")} title="Texto normal"><Type /></button>
            </div>
            <p className={styles.editorHelp}>Los títulos crean elementos; las viñetas y su sangría crean subelementos. Esc guarda y vuelve a la lectura.</p>
            <textarea ref={editorRef} className={styles.editor} value={editorSource} onChange={event => setEditorSource(event.target.value)} onKeyDown={event => {
              if (event.key === "Tab") { event.preventDefault(); changeEditorLine(event.shiftKey ? "outdent" : "indent") }
              if (event.ctrlKey && event.altKey && event.key === "1") { event.preventDefault(); changeEditorLine("heading") }
              if (event.ctrlKey && event.altKey && event.key === "8") { event.preventDefault(); changeEditorLine("bullet") }
            }} aria-label="Editor estructural de Síntesis" spellCheck />
          </> : sheetContent.trim() ? <MarkdownView content={sheetContent} /> : <div className={styles.emptySheet}><Pencil /><p>Este elemento todavía está vacío.</p><button onClick={() => openEditor(sheetNode.id)}>Escribir</button></div>}
        </section>
      ) : (
        <section className={styles.board} onDoubleClick={event => {
          if (event.target !== event.currentTarget) return
          const rect = event.currentTarget.getBoundingClientRect()
          setDraft({ x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(.15, (event.clientY - rect.top) / window.innerHeight), value: "" })
        }} aria-label={current ? `Elementos dentro de ${current.name}` : "Elementos de Síntesis"}>
          {nodes.map(node => <div key={node.id} className={styles.nodeWrap} style={{ left: `${node.x * 100}%`, top: `${node.y * 100}dvh`, "--node-scale": node.scale } as React.CSSProperties}>
            <button className={styles.plaque} onPointerDown={event => {
              if (event.button !== 0) return
              event.currentTarget.setPointerCapture(event.pointerId)
              setDrag({ id: node.id, startX: event.clientX, startY: event.clientY, originX: node.x, originY: node.y, moved: false })
            }} onPointerMove={event => {
              if (!drag || drag.id !== node.id) return
              const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY
              if (!drag.moved && Math.hypot(dx, dy) < 7) return
              const next = updateSynthesisNode(treeRef.current, node.id, { x: drag.originX + dx / window.innerWidth, y: drag.originY + dy / window.innerHeight })
              treeRef.current = next; setTree(next); setDrag({ ...drag, moved: true }); suppressClickRef.current = true
            }} onPointerUp={() => {
              if (drag?.id === node.id && drag.moved) setAcceptedTree(treeRef.current)
              setDrag(null)
            }} onClick={() => {
              if (suppressClickRef.current) { suppressClickRef.current = false; return }
              setCurrentParentId(node.id)
            }} aria-label={`Abrir ${node.name}`}>{node.name}</button>
            <button className={styles.nodeEdit} onPointerDown={event => event.stopPropagation()} onClick={() => openEditor(node.id)} aria-label={`Editar ${node.name}`} title="Editar"><Pencil /></button>
          </div>)}
          {draft ? <form className={styles.draft} style={{ left: `${draft.x * 100}%`, top: `${draft.y * 100}dvh` }} onSubmit={event => { event.preventDefault(); commitDraft() }}>
            <input autoFocus maxLength={80} value={draft.value} onChange={event => setDraft({ ...draft, value: event.target.value })} onBlur={commitDraft} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setDraft(null) } }} aria-label="Nombre del nuevo elemento" />
          </form> : null}
          {!nodes.length && !draft ? <div className={styles.emptyBoard}><Pencil /><p>Doble clic en cualquier lugar para crear el primer elemento.</p></div> : null}
        </section>
      )}
    </main>
  )
}
