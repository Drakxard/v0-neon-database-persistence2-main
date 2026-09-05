import { Fragment, Slice, type Node } from "@tiptap/pm/model"

/** Clean clipboard content only; keep formatting and manual typing untouched. */
export function cleanSynthesisPaste(slice: Slice): Slice {
  const clean = (fragment: Fragment): Fragment => {
    const result: Node[] = []
    let run: Node[] = []
    const flush = () => {
      const text = run.map((node) => node.text!).join("")
      const ranges: Array<[number, number]> = []
      let depth = 0
      let start = 0
      for (let i = 0; i < text.length; i++) {
        if (text[i] === "[") {
          if (depth === 0) start = i
          depth++
        } else if (text[i] === "]" && depth > 0 && --depth === 0) {
          ranges.push([start, i + 1])
        }
      }
      let offset = 0
      for (const node of run) {
        const end = offset + node.text!.length
        let cursor = offset
        for (const [from, to] of ranges) {
          if (to <= cursor || from >= end) continue
          if (from > cursor) result.push(node.cut(cursor - offset, from - offset))
          cursor = Math.min(end, to)
        }
        if (cursor < end) result.push(node.cut(cursor - offset))
        offset = end
      }
      run = []
    }
    fragment.forEach((node) => {
      if (node.isText) {
        run.push(node)
        return
      }
      flush()
      result.push(node.isLeaf ? node : node.copy(clean(node.content)))
    })
    flush()
    return Fragment.fromArray(result)
  }
  return new Slice(clean(slice.content), slice.openStart, slice.openEnd)
}
