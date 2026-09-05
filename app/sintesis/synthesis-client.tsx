"use client"

import dynamic from "next/dynamic"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, Pencil, Trash2 } from "lucide-react"
import { fetchSubjectMaterialContainers } from "@/lib/material-containers-client"
import { requireOkJson } from "@/lib/client/api"
import type { SubjectDayMaterial } from "@/lib/study-types"
import { reconcileSynthesisMaterials, recordSynthesisRemovals, removeSynthesisNode } from "@/lib/synthesis-material-links"
import { readMaterialSynthesis, SYNTHESIS_MATERIALS_CHANGED_EVENT } from "@/lib/client/synthesis-materials"
import backgroundImage from "../../sintesis/sintesis-fondo.jpg"
import { buildSynthesisLocalStorageKey, buildSynthesisReturnTokenStorageKey, type SynthesisContext } from "@/lib/synthesis-context"
import { deleteSynthesisImage } from "@/lib/client/synthesis-images"
import {
  SYNTHESIS_WORKSPACE_PENDING_KEY, SYNTHESIS_WORKSPACE_STORAGE_KEY, childrenOf,
  createEmptySynthesisWorkspace, createSynthesisId, deriveSynthesisNodes, ensureSynthesisDocument,
  extractSynthesisBranchDocument, normalizeSynthesisWorkspace,
  replaceSynthesisBranch, scaleSynthesisWorkspace,
  referencedLocalImageIds,
  type SynthesisWorkspaceV2, type TiptapJSON,
} from "@/lib/synthesis-workspace"
import styles from "./sintesis.module.css"

const SimpleEditor = dynamic(
  () => import("@/components/tiptap-templates/simple/simple-editor").then((module) => module.SimpleEditor),
  { ssr: false, loading: () => <div className={styles.editorLoading}>Abriendo editor…</div> }
)

type Drag = { id: string; startX: number; startY: number; originX: number; originY: number; moved: boolean }
type EditorSession = { nodeId: string | null; document: TiptapJSON; baseDocument: TiptapJSON; normalizationId: string; returnParentId: string | null; key: number }

function readLocalWorkspace(key: string) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null")
    if (!parsed) return null
    if (parsed.workspace) return normalizeSynthesisWorkspace(parsed.workspace)
    return normalizeSynthesisWorkspace(parsed)
  } catch { return null }
}

export function SynthesisClient({ context, legacyReturnToken }: { context: SynthesisContext; legacyReturnToken: string }) {
  const router = useRouter()
  const storageKey = buildSynthesisLocalStorageKey(SYNTHESIS_WORKSPACE_STORAGE_KEY, context)
  const pendingKey = buildSynthesisLocalStorageKey(SYNTHESIS_WORKSPACE_PENDING_KEY, context)
  const returnTokenKey = buildSynthesisReturnTokenStorageKey(context)
  const [workspace, setWorkspace] = useState(createEmptySynthesisWorkspace)
  const workspaceRef = useRef(workspace)
  const [message, setMessage] = useState("")
  const [currentParentId, setCurrentParentId] = useState<string | null>(null)
  const [editorSession, setEditorSession] = useState<EditorSession | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const suppressClickRef = useRef(false)
  const editorHistoryRef = useRef(false)
  const removedImageIdsRef = useRef(new Set<string>())
  const editorOpenRef = useRef(false)
  const nodes = useMemo(() => deriveSynthesisNodes(workspace.document), [workspace.document])

  const acceptWorkspace = useCallback((input: SynthesisWorkspaceV2) => {
    const normalized = normalizeSynthesisWorkspace(input)
    localStorage.setItem(storageKey, JSON.stringify(normalized))
    workspaceRef.current = normalized
    setWorkspace(normalized)
    return normalized
  }, [storageKey])

  useEffect(() => {
    const cached = readLocalWorkspace(storageKey)
    const pending = readLocalWorkspace(pendingKey)
    const local = pending ?? cached ?? createEmptySynthesisWorkspace()
    workspaceRef.current = local; setWorkspace(local); localStorage.setItem(storageKey, JSON.stringify(local))
    setCurrentParentId(null); setEditorSession(null); editorOpenRef.current = false
    if (pending) localStorage.removeItem(pendingKey)
  }, [pendingKey, storageKey])

  useEffect(() => {
    if (currentParentId && !nodes.some((node) => node.id === currentParentId)) setCurrentParentId(null)
  }, [currentParentId, nodes])

  useEffect(() => {
    let disposed = false
    let loading = false
    const refresh = async () => {
      if (loading || editorOpenRef.current) return
      loading = true
      try {
        const params = new URLSearchParams({ subjectId: context.subjectId, weekNumber: String(context.weekNumber), scope: "week" })
        const results = await Promise.allSettled([
          fetchSubjectMaterialContainers(context.subjectId),
          fetch(`/api/subject-day-materials?${params}`, { cache: "no-store" })
            .then((response) => requireOkJson<SubjectDayMaterial[]>(response, "No se pudieron cargar los PDF de Síntesis.")),
        ])
        const [containers, materials] = results
        if (containers.status === "rejected") throw containers.reason
        if (materials.status === "rejected") throw materials.reason
        if (disposed || editorOpenRef.current) return
        const latest = readMaterialSynthesis(context) ?? workspaceRef.current
        acceptWorkspace(reconcileSynthesisMaterials(latest, containers.value, materials.value))
      } catch (error) {
        if (!disposed) setMessage(error instanceof Error ? error.message : "No se pudo actualizar Síntesis.")
      } finally { loading = false }
    }
    const onStorage = (event: StorageEvent) => { if (event.key === storageKey) void refresh() }
    void refresh()
    window.addEventListener("focus", refresh)
    window.addEventListener("storage", onStorage)
    window.addEventListener(SYNTHESIS_MATERIALS_CHANGED_EVENT, refresh)
    return () => {
      disposed = true
      window.removeEventListener("focus", refresh)
      window.removeEventListener("storage", onStorage)
      window.removeEventListener(SYNTHESIS_MATERIALS_CHANGED_EVENT, refresh)
    }
  }, [acceptWorkspace, context.subjectId, context.weekNumber, storageKey])

  useEffect(() => {
    if (legacyReturnToken) sessionStorage.setItem(returnTokenKey, legacyReturnToken)
    const canonicalParams = new URLSearchParams({
      subjectId: context.subjectId,
      weekNumber: String(context.weekNumber),
    })
    if (window.location.search !== `?${canonicalParams.toString()}`) {
      router.replace(`/sintesis?${canonicalParams.toString()}`)
    }
  }, [context.subjectId, context.weekNumber, legacyReturnToken, returnTokenKey, router])

  useEffect(() => {
    const persistBeforeLeaving = () => {
      localStorage.setItem(storageKey, JSON.stringify(workspaceRef.current))
    }
    window.addEventListener("pagehide", persistBeforeLeaving); window.addEventListener("beforeunload", persistBeforeLeaving)
    return () => { window.removeEventListener("pagehide", persistBeforeLeaving); window.removeEventListener("beforeunload", persistBeforeLeaving) }
  }, [storageKey])

  const closeEditor = useCallback(async () => {
    const session = editorSession
    if (!session) return
    localStorage.setItem(storageKey, JSON.stringify(workspaceRef.current))
    const removedImageIds = [...removedImageIdsRef.current]
    removedImageIdsRef.current.clear()
    await Promise.allSettled(removedImageIds.map(deleteSynthesisImage))
    setCurrentParentId(session.returnParentId); setEditorSession(null); editorHistoryRef.current = false; editorOpenRef.current = false
    window.dispatchEvent(new Event(SYNTHESIS_MATERIALS_CHANGED_EVENT))
  }, [editorSession, storageKey])

  useEffect(() => {
    const onPopState = () => { if (editorHistoryRef.current) void closeEditor() }
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [closeEditor])

  const openEditor = (nodeId: string | null) => {
    editorOpenRef.current = true
    const document = nodeId ? extractSynthesisBranchDocument(workspaceRef.current.document, nodeId) : workspaceRef.current.document
    removedImageIdsRef.current.clear()
    setEditorSession({ nodeId, document, baseDocument: workspaceRef.current.document, normalizationId: createSynthesisId(), returnParentId: currentParentId, key: Date.now() })
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
    acceptWorkspace(recordSynthesisRemovals(workspaceRef.current, completeDocument))
  }, [acceptWorkspace, editorSession])

  const goHome = useCallback(() => {
    localStorage.setItem(storageKey, JSON.stringify(workspaceRef.current))
    const returnToken = sessionStorage.getItem(returnTokenKey) || legacyReturnToken
    sessionStorage.removeItem(returnTokenKey)
    router.push(returnToken ? `/?returnToken=${encodeURIComponent(returnToken)}` : "/")
  }, [legacyReturnToken, returnTokenKey, router, storageKey])

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        if (editorSession) { window.history.back(); return }
        if (currentParentId) { setCurrentParentId(nodes.find((node) => node.id === currentParentId)?.parentId ?? null); return }
        void goHome(); return
      }
      if ((!event.ctrlKey && !event.metaKey) || editorSession) return
      const increase = event.key === "+" || event.key === "=" || event.code === "NumpadAdd"
      const decrease = event.key === "-" || event.code === "NumpadSubtract"
      if (!increase && !decrease) return
      event.preventDefault()
      acceptWorkspace(scaleSynthesisWorkspace(workspaceRef.current, workspaceRef.current.defaultScale + (increase ? 0.1 : -0.1)))
    }
    window.addEventListener("keydown", keydown, { passive: false })
    return () => window.removeEventListener("keydown", keydown)
  }, [acceptWorkspace, currentParentId, editorSession, goHome, nodes])

  if (editorSession) return <main className={styles.editorOnly}>
    {message ? <div className={styles.notice}>{message}<button onClick={() => setMessage("")} aria-label="Cerrar aviso">×</button></div> : null}
    <SimpleEditor key={editorSession.key} content={editorSession.document} onChange={updateEditorDocument} onError={setMessage}
      fontSize={workspace.editorFontSize} onFontSizeChange={(editorFontSize) => {
        try { acceptWorkspace({ ...workspaceRef.current, editorFontSize }) }
        catch { setMessage("No se pudo guardar el tamaño del texto.") }
      }} />
  </main>

  const currentNodes = childrenOf(nodes, currentParentId)
  const currentNode = currentParentId ? nodes.find((node) => node.id === currentParentId) ?? null : null

  const deleteNode = (nodeId: string) => {
    const next = removeSynthesisNode(workspaceRef.current, nodeId)
    const retainedImages = new Set(referencedLocalImageIds(next.document))
    const removed = referencedLocalImageIds(workspaceRef.current.document).filter((id) => !retainedImages.has(id))
    try {
      acceptWorkspace(next)
      void Promise.allSettled(removed.map(deleteSynthesisImage))
    } catch { setMessage("No se pudo guardar la eliminación del nodo.") }
  }

  return <main className={styles.root} style={{ backgroundImage: `linear-gradient(rgba(74,30,14,.2),rgba(74,30,14,.2)), url(${backgroundImage.src})` }}>
    <header className={styles.topbar}>
      <button className={styles.backPlaque} onClick={() => {
        if (currentParentId) setCurrentParentId(currentNode?.parentId ?? null)
        else void goHome()
      }} aria-label={currentNode ? `Volver desde ${currentNode.name}` : "Volver"}><ArrowLeft aria-hidden="true" /></button>
      <div className={styles.zoom}><button onClick={() => openEditor(currentParentId)} aria-label={currentNode ? `Editar ${currentNode.name}` : "Editar la Síntesis completa"} title="Editar"><Pencil /></button></div>
    </header>
    {message ? <div className={styles.notice}>{message}<button onClick={() => setMessage("")} aria-label="Cerrar aviso">×</button></div> : null}
    <section className={styles.board} style={{ "--board-height": `${Math.max(1.5, ...currentNodes.map((node) => (workspace.layout[node.id]?.y ?? 0) + 0.3)) * 100}dvh` } as React.CSSProperties} aria-label="Nodos de Síntesis">{currentNodes.map((node) => {
        const position = workspace.layout[node.id] ?? { x: 0.5, y: 0.4, scale: 1 }
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
            setCurrentParentId(node.id)
          }} aria-label={`Abrir ${node.name}`}>{node.name}</button>
          <button className={styles.nodeEdit} onPointerDown={(event) => event.stopPropagation()} onClick={() => openEditor(node.id)} aria-label={`Editar ${node.name}`} title="Editar"><Pencil /></button>
          <button className={`${styles.nodeEdit} ${styles.nodeDelete}`} onPointerDown={(event) => event.stopPropagation()} onClick={() => deleteNode(node.id)} aria-label={`Eliminar ${node.name} de Síntesis`} title="Eliminar de Síntesis"><Trash2 /></button>
        </div>
      })}</section>
  </main>
}
