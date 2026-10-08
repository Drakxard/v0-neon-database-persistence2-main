"use client"

import { useEffect, useRef, type PointerEvent, type MouseEvent } from "react"

export function usePdfLongPress(remove: () => Promise<void>, failed: (error: unknown) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const origin = useRef({ x: 0, y: 0 })
  const fired = useRef(false)
  const cancel = () => { if (timer.current) clearTimeout(timer.current); timer.current = null }
  useEffect(() => cancel, [])
  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (!event.isPrimary || event.button !== 0) return
      cancel(); fired.current = false; origin.current = { x: event.clientX, y: event.clientY }
      timer.current = setTimeout(() => { timer.current = null; fired.current = true; void remove().catch(failed) }, 1000)
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 10) cancel()
    },
    onPointerUp: cancel, onPointerCancel: cancel, onPointerLeave: cancel,
    onContextMenu: (event: MouseEvent<HTMLElement>) => event.preventDefault(),
    onClickCapture: (event: MouseEvent<HTMLElement>) => {
      if (fired.current) { event.preventDefault(); event.stopPropagation(); fired.current = false }
    },
  }
}
