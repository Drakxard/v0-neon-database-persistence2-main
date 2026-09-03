"use client"

import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, Pencil, RotateCcw, Save } from "lucide-react"
import backgroundImage from "../../sintesis/sintesis-fondo.jpg"
import { buildSynthesisLocalStorageKey, type SynthesisContext } from "@/lib/synthesis-context"
import { deleteSynthesisImage } from "@/lib/client/synthesis-images"
import {
  SYNTHESIS_WORKSPACE_PENDING_KEY, SYNTHESIS_WORKSPACE_STORAGE_KEY, childrenOf,
  createEmptySynthesisWorkspace, createSynthesisId, deriveSynthesisNodes, ensureSynthesisDocument,
  extractSynthesisBranchDocument, normalizeSynthesisWorkspace,
  reconcileSynthesisLayout, replaceSynthesisBranch, scaleSynthesisWorkspace,
  referencedLocalImageIds,
  type SynthesisWorkspaceV2, type TiptapJSON,
} from "@/lib/synthesis-workspace"
import styles from "./sintesis.module.css"

const SimpleEditor = dynamic(
  () => import("@/components/tiptap-templates/simple/simple-editor").then((module) => module.SimpleEditor),
  { ssr: false, loading: () => <div className={styles.editorLoading}>Abriendo editor…</div> }
)

type Conflict = { workspace: SynthesisWorkspaceV2 | null; etag: string | null }
type Drag = { id: string; startX: number; startY: number; originX: number; originY: number; moved: boolean }
type EditorSession = { nodeId: string | null; document: TiptapJSON; baseDocument: TiptapJSON; normalizationId: string; returnParentId: string | null; returnSheetId: string | null; key: number }

function readLocalWorkspace(key: string) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null")
    if (!parsed) return null
    if (parsed.workspace) return { workspace: normalizeSynthesisWorkspace(parsed.workspace), etag: typeof parsed.etag === "string" ? parsed.etag : null }
    return { workspace: normalizeSynthesisWorkspace(parsed), etag: null }
  } catch { return null }
}

export function SynthesisClient({ context, subjectName, returnToken }: { context: SynthesisContext; subjectName: string; returnToken: string }) {
  const router = useRouter()
  const storageKey = buildSynthesisLocalStorageKey(SYNTHESIS_WORKSPACE_STORAGE_KEY, context)
  const pendingKey = buildSynthesisLocalStorageKey(SYNTHESIS_WORKSPACE_PENDING_KEY, context)
  const [workspace, setWorkspace] = useState(createEmptySynthesisWorkspace)
  const workspaceRef = useRef(workspace)
  const etagRef = useRef<string | null>(null)
  const editVersionRef = useRef(0)
  const savingRef = useRef<Promise<boolean> | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const [message, setMessage] = useState("")
  const [conflict, setConflict] = useState<Conflict | null>(null)
  const [currentParentId, setCurrentParentId] = useState<string | null>(null)
  const [sheetNodeId, setSheetNodeId] = useState<string | null>(null)
  const [editorSession, setEditorSession] = useState<EditorSession | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const suppressClickRef = useRef(false)
  const editorHistoryRef = useRef(false)
  const removedImageIdsRef = useRef(new Set<string>())
  const nodes = useMemo(() => deriveSynthesisNodes(workspace.document), [workspace.document])

  const acceptWorkspace = useCallback((input: SynthesisWorkspaceV2, immediate = false) => {
    const normalized = normalizeSynthesisWorkspace(input)
    workspaceRef.current = normalized
    setWorkspace(normalized)
    editVersionRef.current++
    localStorage.setItem(storageKey, JSON.stringify(normalized))
    localStorage.setItem(pendingKey, JSON.stringify({ workspace: normalized, etag: etagRef.current }))
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    if (!immediate) saveTimerRef.current = window.setTimeout(() => void syncNowRef.current(), 700)
    return normalized
  }, [pendingKey, storageKey])

  const syncNowRef = useRef<(force?: boolean) => Promise<boolean>>(async () => false)
  syncNowRef.current = async (force = false) => {
    if (savingRef.current) return savingRef.current
    if (!force && !localStorage.getItem(pendingKey)) return true
    const snapshot = workspaceRef.current
    const version = editVersionRef.current
    let encounteredConflict = false
    const operation = (async () => {
      try {
        const response = await fetch("/api/inscreen/synthesis-tree", {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...context, workspace: snapshot, etag: etagRef.current, force }), keepalive: true,
        })
        const payload = await response.json().catch(() => null)
        if (response.status === 409 && payload?.conflict) {
          encounteredConflict = true
          setConflict({ workspace: payload.workspace ? normalizeSynthesisWorkspace(payload.workspace) : null, etag: payload.etag ?? null })
          setMessage("Hay otra versión remota. Tu edición continúa guardada en este equipo.")
          return false
        }
        if (!response.ok || !payload?.workspace) throw new Error(payload?.error || "No se confirmó el guardado remoto.")
        etagRef.current = payload.etag ?? null
        if (editVersionRef.current === version) {
          const confirmed = normalizeSynthesisWorkspace(payload.workspace)
          workspaceRef.current = confirmed; setWorkspace(confirmed)
          localStorage.setItem(storageKey, JSON.stringify(confirmed)); localStorage.removeItem(pendingKey); setMessage("")
        } else localStorage.setItem(pendingKey, JSON.stringify({ workspace: workspaceRef.current, etag: etagRef.current }))
        return true
      } catch (error) {
        setMessage(error instanceof Error ? `${error.message} Los cambios quedan pendientes en este equipo.` : "El guardado remoto quedó pendiente.")
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
    const cached = readLocalWorkspace(storageKey)
    const pending = readLocalWorkspace(pendingKey)
    const local = pending ?? cached
    if (local) { workspaceRef.current = local.workspace; setWorkspace(local.workspace); etagRef.current = pending?.etag ?? null }
    let cancelled = false
    void (async () => {
      try {
        const search = new URLSearchParams({ subjectId: context.subjectId, weekNumber: String(context.weekNumber) })
        const response = await fetch(`/api/inscreen/synthesis-tree?${search}`, { cache: "no-store" })
        const payload = await response.json().catch(() => null)
        if (!response.ok) throw new Error(payload?.error || "No se pudo abrir la Síntesis remota.")
        if (cancelled) return
        if (pending) { etagRef.current = pending.etag; void syncNowRef.current() }
        else if (payload.workspace) {
          const remote = normalizeSynthesisWorkspace(payload.workspace)
          etagRef.current = payload.etag ?? null; workspaceRef.current = remote; setWorkspace(remote)
          localStorage.setItem(storageKey, JSON.stringify(remote))
        } else if (cached && deriveSynthesisNodes(cached.workspace.document).length) {
          etagRef.current = null; acceptWorkspace(cached.workspace, true); void syncNowRef.current()
        }
      } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo abrir la Síntesis remota.") }
    })()
    return () => { cancelled = true }
  }, [acceptWorkspace, context.subjectId, context.weekNumber, pendingKey, storageKey])

  useEffect(() => {
    const retry = () => { if (localStorage.getItem(pendingKey)) void syncNowRef.current() }
    const persistBeforeLeaving = () => {
      localStorage.setItem(storageKey, JSON.stringify(workspaceRef.current))
      if (!localStorage.getItem(pendingKey)) return
      void fetch("/api/inscreen/synthesis-tree", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...context, workspace: workspaceRef.current, etag: etagRef.current }), keepalive: true,
      }).catch(() => undefined)
    }
    window.addEventListener("online", retry); window.addEventListener("pagehide", persistBeforeLeaving); window.addEventListener("beforeunload", persistBeforeLeaving)
    return () => { window.removeEventListener("online", retry); window.removeEventListener("pagehide", persistBeforeLeaving); window.removeEventListener("beforeunload", persistBeforeLeaving) }
  }, [context, pendingKey, storageKey])

  const closeEditor = useCallback(async () => {
    const session = editorSession
    if (!session) return
    await syncNowRef.current()
    if (localStorage.getItem(pendingKey)) await syncNowRef.current()
    const removedImageIds = [...removedImageIdsRef.current]
    removedImageIdsRef.current.clear()
    await Promise.allSettled(removedImageIds.map(deleteSynthesisImage))
    setCurrentParentId(session.returnParentId); setSheetNodeId(session.returnSheetId); setEditorSession(null); editorHistoryRef.current = false
  }, [editorSession, pendingKey])

  useEffect(() => {
    const onPopState = () => { if (editorHistoryRef.current) void closeEditor() }
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [closeEditor])

  const openEditor = (nodeId: string | null) => {
    const document = nodeId ? extractSynthesisBranchDocument(workspaceRef.current.document, nodeId) : workspaceRef.current.document
    removedImageIdsRef.current.clear()
    setEditorSession({ nodeId, document, baseDocument: workspaceRef.current.document, normalizationId: createSynthesisId(), returnParentId: currentParentId, returnSheetId: sheetNodeId, key: Date.now() })
    window.history.pushState({ synthesisEditor: true }, ""); editorHistoryRef.current = true
  }

  const updateEditorDocument = useCallback((documentInput: TiptapJSON) => {
    const session = editorSession
    if (!session) return
    let firstGeneratedId = true
    const document = ensureSynthesisDocument(documentInput, () => {
      if (firstGeneratedId) { firstGeneratedId = false; return session.normalizationId }
      return createSynthesisId()
    })
    const completeDocument = session.nodeId ? replaceSynthesisBranch(session.baseDocument, session.nodeId, document) : document
    const previousImageIds = new Set(referencedLocalImageIds(workspaceRef.current.document))
    const nextImageIds = new Set(referencedLocalImageIds(completeDocument))
    for (const id of previousImageIds) if (!nextImageIds.has(id)) removedImageIdsRef.current.add(id)
    for (const id of nextImageIds) removedImageIdsRef.current.delete(id)
    const derived = deriveSynthesisNodes(completeDocument)
    acceptWorkspace({ ...workspaceRef.current, document: completeDocument, layout: reconcileSynthesisLayout(derived, workspaceRef.current.layout, workspaceRef.current.defaultScale) })
  }, [acceptWorkspace, editorSession])

  const goHome = useCallback(async () => {
    await syncNowRef.current()
    if (localStorage.getItem(pendingKey)) await syncNowRef.current()
    router.push(returnToken ? `/?returnToken=${encodeURIComponent(returnToken)}` : "/")
  }, [pendingKey, returnToken, router])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        if (editorSession) { window.history.back(); return }
        if (sheetNodeId) { setSheetNodeId(null); return }
        if (currentParentId) { setCurrentParentId(nodes.find((node) => node.id === currentParentId)?.parentId ?? null); return }
        void goHome(); return
      }
      if ((!event.ctrlKey && !event.metaKey) || editorSession || sheetNodeId) return
      const increase = event.key === "+" || event.key === "=" || event.code === "NumpadAdd"
      const decrease = event.key === "-" || event.code === "NumpadSubtract"
      if (!increase && !decrease) return
      event.preventDefault()
      acceptWorkspace(scaleSynthesisWorkspace(workspaceRef.current, workspaceRef.current.defaultScale + (increase ? 0.1 : -0.1)))
    }
    window.addEventListener("keydown", keydown, { passive: false })
    return () => window.removeEventListener("keydown", keydown)
  }, [acceptWorkspace, currentParentId, editorSession, goHome, nodes, sheetNodeId])

  if (editorSession) return <main className={styles.editorOnly}>
    {message ? <div className={styles.notice}>{message}<button onClick={() => setMessage("")} aria-label="Cerrar aviso">×</button></div> : null}
    <SimpleEditor key={editorSession.key} content={editorSession.document} onChange={updateEditorDocument} onError={setMessage} />
  </main>

  const currentNodes = childrenOf(nodes, currentParentId)
  const sheetNode = sheetNodeId ? nodes.find((node) => node.id === sheetNodeId) ?? null : null

  return <main className={styles.root} style={{ backgroundImage: `linear-gradient(rgba(74,30,14,.2),rgba(74,30,14,.2)), url(${backgroundImage.src})` }}>
    <header className={styles.topbar}>
      <button className={styles.backPlaque} onClick={() => {
        if (sheetNodeId) setSheetNodeId(null)
        else if (currentParentId) setCurrentParentId(nodes.find((node) => node.id === currentParentId)?.parentId ?? null)
        else void goHome()
      }} aria-label="Volver"><ArrowLeft aria-hidden="true" /></button>
      <div className={styles.location}><strong>{subjectName}</strong></div>
      <div className={styles.zoom}><button onClick={() => openEditor(sheetNodeId)} aria-label={sheetNodeId ? "Editar esta rama" : "Editar la Síntesis completa"} title="Editar"><Pencil /></button></div>
    </header>
    {message ? <div className={styles.notice}>{message}<button onClick={() => setMessage("")} aria-label="Cerrar aviso">×</button></div> : null}
    {conflict ? <section className={styles.conflict} role="alert"><p>Tu edición local no se perdió. Elegí qué versión conservar.</p><button onClick={() => {
      const remote = conflict.workspace ?? createEmptySynthesisWorkspace()
      workspaceRef.current = remote; setWorkspace(remote); etagRef.current = conflict.etag
      localStorage.setItem(storageKey, JSON.stringify(remote)); localStorage.removeItem(pendingKey); setConflict(null); setMessage("")
    }}><RotateCcw /> Cargar remota</button><button onClick={() => { etagRef.current = conflict.etag; setConflict(null); void syncNowRef.current(true) }}><Save /> Reemplazar remota</button></section> : null}
    {sheetNode ? <section className={styles.sheet}><SimpleEditor key={`read-${sheetNode.id}`} content={extractSynthesisBranchDocument(workspace.document, sheetNode.id)} editable={false} /></section>
      : <section className={styles.board} aria-label="Nodos de Síntesis">{currentNodes.map((node) => {
        const position = workspace.layout[node.id] ?? { x: 0.5, y: 0.4, scale: 1 }
        const hasChildren = nodes.some((candidate) => candidate.parentId === node.id)
        const hasBody = node.body.some((block) => Boolean(block.content?.length || block.type === "image" || block.type === "horizontalRule"))
        return <div key={node.id} className={styles.nodeWrap} style={{ left: `${position.x * 100}%`, top: `${position.y * 100}dvh`, "--node-scale": position.scale } as React.CSSProperties}>
          <button className={styles.plaque} onPointerDown={(event) => {
            if (event.button !== 0) return
            event.currentTarget.setPointerCapture(event.pointerId)
            setDrag({ id: node.id, startX: event.clientX, startY: event.clientY, originX: position.x, originY: position.y, moved: false })
          }} onPointerMove={(event) => {
            if (!drag || drag.id !== node.id) return
            const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY
            if (!drag.moved && Math.hypot(dx, dy) < 7) return
            const next = normalizeSynthesisWorkspace({ ...workspaceRef.current, layout: { ...workspaceRef.current.layout, [node.id]: { ...position, x: drag.originX + dx / window.innerWidth, y: drag.originY + dy / window.innerHeight } } })
            workspaceRef.current = next; setWorkspace(next); setDrag({ ...drag, moved: true }); suppressClickRef.current = true
          }} onPointerUp={() => { if (drag?.id === node.id && drag.moved) acceptWorkspace(workspaceRef.current); setDrag(null) }} onClick={() => {
            if (suppressClickRef.current) { suppressClickRef.current = false; return }
            if (hasChildren) setCurrentParentId(node.id); else if (hasBody) setSheetNodeId(node.id)
          }} aria-label={hasChildren ? `Abrir ${node.name}` : hasBody ? `Leer ${node.name}` : node.name}>{node.name}</button>
          <button className={styles.nodeEdit} onPointerDown={(event) => event.stopPropagation()} onClick={() => openEditor(node.id)} aria-label={`Editar ${node.name}`} title="Editar"><Pencil /></button>
        </div>
      })}</section>}
  </main>
}
