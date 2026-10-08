import type { TiptapJSON } from "./synthesis-workspace.ts"

export function synthesisMathRanges(text: string) {
  const delimiters = [["\\(", "\\)", false], ["\\[", "\\]", true], ["$$", "$$", true], ["$", "$", false]] as const
  const escaped = (at: number) => {
    let count = 0
    while (at > 0 && text[--at] === "\\") count++
    return count % 2 === 1
  }
  const ranges: {from: number; to: number; latex: string; display: boolean}[] = []
  for (let at = 0; at < text.length; at++) {
    if (escaped(at)) continue
    for (const [open, close, display] of delimiters) {
      if (!text.startsWith(open, at)) continue
      if (open === "$" && (text[at + 1] === "$" || /\s/.test(text[at + 1] ?? ""))) continue
      let end = at + open.length
      while ((end = text.indexOf(close, end)) !== -1 && escaped(end)) end += close.length
      if (end === -1) continue
      const body = text.slice(at + open.length, end)
      if (open === "$" && /\s$/.test(body)) continue
      const latex = body.trim()
      if (!latex) continue
      ranges.push({from:at,to:end+close.length,latex,display})
      at = end + close.length - 1
      break
    }
  }
  return ranges
}

// Import both new clipboard content and existing notes, retaining their marks
// and structure. Code remains literal. The original LaTeX lives in node attrs.
export function normalizeSynthesisMath(node: TiptapJSON): TiptapJSON {
  if (!node.content || node.type === "codeBlock") return node
  const children = node.content.map(normalizeSynthesisMath)
  const content: TiptapJSON[] = []
  let run: TiptapJSON[] = []
  const flush = () => {
    const text = run.map(item => item.text ?? "").join("")
    const ranges = synthesisMathRanges(text)
    let offset = 0
    const pieces = run.map(item => { const from = offset; offset += item.text!.length; return {item,from,to:offset} })
    const append = (from: number, to: number) => {
      for (const piece of pieces) {
        const start = Math.max(from, piece.from), end = Math.min(to, piece.to)
        if (end > start) content.push({...piece.item,text:text.slice(start,end)})
      }
    }
    let cursor = 0
    for (const range of ranges) {
      append(cursor, range.from)
      content.push({type:"synthesisMath",attrs:{latex:range.latex,display:range.display},marks:pieces.find(piece => piece.from <= range.from && piece.to > range.from)?.item.marks})
      cursor = range.to
    }
    append(cursor,text.length)
    run = []
  }
  for (const child of children) {
    if (child.type === "text" && !child.marks?.some(mark => mark.type === "code")) run.push(child)
    else { flush(); content.push(child) }
  }
  flush()
  return {...node,content}
}
