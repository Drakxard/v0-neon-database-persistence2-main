"use client"

import { useEffect, useRef, type ComponentProps } from "react"
import rough from "roughjs"
import { cn } from "@/lib/utils"

export function HandDrawnBubble({ seed, color, className, children, ...props }: ComponentProps<"button"> & { seed: string; color: string }) {
  const svgRef = useRef<SVGSVGElement>(null)
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const observer = new ResizeObserver(() => {
      const { width, height } = svg.getBoundingClientRect()
      if (!width || !height) return
      let numericSeed = 1
      for (const character of seed) numericSeed = (numericSeed * 31 + character.charCodeAt(0)) >>> 0
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`)
      svg.replaceChildren(rough.svg(svg).ellipse(width / 2, height / 2, width - 12, height - 12, {
        seed: numericSeed || 1, fill: color, fillStyle: "solid", stroke: "#252525", strokeWidth: 2.5, roughness: 0.9,
      }))
    })
    observer.observe(svg)
    return () => observer.disconnect()
  }, [seed, color])
  return <button type="button" className={cn("relative flex min-h-32 w-full items-center justify-center rounded-[50%] px-10 py-7 text-center text-2xl leading-snug focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black disabled:opacity-60", className)} {...props}>
    <svg ref={svgRef} aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full" />
    <span className="pointer-events-none relative min-w-0 break-words [overflow-wrap:anywhere]">{children}</span>
  </button>
}
