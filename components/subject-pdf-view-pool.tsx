"use client"

import { useEffect, useState, useRef } from "react"
import { SubjectPdfFragment } from "./subject-pdf-fragment"
import type { PdfSearchResult } from "@/lib/subject-pdf-search"

const keyFor = (result: PdfSearchResult) => JSON.stringify([result.id, result.fileId, result.query, result.title, result.candidate, result.decision])

export function SubjectPdfViewPool({ candidates, active, subjectId, onBack, onUndo, onSearchAgain }: {
  candidates: PdfSearchResult[]; active: PdfSearchResult | null; subjectId: string;
  onBack: () => void; onUndo: () => void; onSearchAgain: () => void
}) {
  const [prepared, setPrepared] = useState<PdfSearchResult[]>([])
  const completed = useRef(new Set<string>())
  const [revision, setRevision] = useState(0)
  const [visible, setVisible] = useState<string[]>([])
  const scope = useRef("")
  const preparedSubject = useRef(subjectId)
  const activeKey = active ? keyFor(active) : null
  const candidateKeys = JSON.stringify(candidates.map(keyFor))
  useEffect(() => {
    const nodes = [...document.querySelectorAll<HTMLElement>("[data-voice-pdf-id]")]
    const ids = new Set<string>()
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.voicePdfId!
        if (entry.isIntersecting) ids.add(id); else ids.delete(id)
      }
      setVisible([...ids])
    }, { root: document.querySelector("[data-voice-bubbles]") })
    nodes.forEach(node => observer.observe(node))
    return () => observer.disconnect()
  }, [candidateKeys])
  useEffect(() => {
    setPrepared(previous => {
      if (preparedSubject.current !== subjectId) {
        preparedSubject.current = subjectId
        previous = []
        completed.current.clear()
        scope.current = ""
      }
      const nextScope = JSON.stringify([subjectId, ...new Set(candidates.map(result => result.query))])
      if (candidates.length && scope.current !== nextScope) {
        scope.current = nextScope
        previous = previous.filter(item => candidates.some(result => keyFor(result) === keyFor(item)))
        completed.current = new Set([...completed.current].filter(key => previous.some(item => keyFor(item) === key)))
      }
      const wanted = [...new Map([...(active ? [active] : []), ...candidates].map(result => [keyFor(result), result])).values()]
        .sort((a, b) => Number(visible.includes(b.id)) - Number(visible.includes(a.id)))
      const next = [...previous]
      if (active && !next.some(item => keyFor(item) === activeKey)) next.push(active)
      let loading = next.filter(item => !completed.current.has(keyFor(item))).length
      for (const result of wanted) {
        if (loading >= 2) break
        if (!next.some(item => keyFor(item) === keyFor(result))) { next.push(result); loading++ }
      }
      return next.length === previous.length && next.every((item, i) => item === previous[i]) ? previous : next
    })
  }, [activeKey, candidateKeys, revision, visible, subjectId])
  const views = active && !prepared.some(result => keyFor(result) === activeKey) ? [active, ...prepared] : prepared
  return <>{views.map(result => {
    const viewing = keyFor(result) === activeKey
    return <div key={keyFor(result)} aria-hidden={!viewing} inert={!viewing} data-pdf-preloaded={result.id}
      style={{ position: "fixed", inset: 0, zIndex: 10, opacity: viewing ? 1 : 0, pointerEvents: viewing ? "auto" : "none", display: "flex", flexDirection: "column" }}>
      <SubjectPdfFragment result={result} subjectId={subjectId} active={viewing} onPrepared={() => {
        const key = keyFor(result)
        if (!completed.current.has(key)) { completed.current.add(key); setRevision(n => n + 1) }
      }} onBack={onBack} onUndo={onUndo} onSearchAgain={onSearchAgain} />
    </div>
  })}</>
}
