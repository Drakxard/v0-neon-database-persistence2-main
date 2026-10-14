"use client"

import { useEffect, useRef, type PointerEvent, type MouseEvent } from "react"

export function useVoiceLongPress(onLongPress?: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fired = useRef(false)
  const origin = useRef({ x: 0, y: 0 })
  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(() => cancel, [])
  return {
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      if (!onLongPress || !event.isPrimary || event.button !== 0) return
      cancel()
      fired.current = false
      origin.current = { x: event.clientX, y: event.clientY }
      timer.current = setTimeout(() => { timer.current = null; fired.current = true; onLongPress() }, 1000)
    },
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
      if (Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 10) cancel()
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu: (event: MouseEvent<HTMLButtonElement>) => { if (onLongPress) event.preventDefault() },
    onClickCapture: (event: MouseEvent<HTMLButtonElement>) => {
      // A keyboard click must still work if closing the dialog swallowed pointerup.
      if (fired.current && event.detail !== 0) {
        event.preventDefault()
        event.stopPropagation()
      }
      fired.current = false
    },
  }
}
