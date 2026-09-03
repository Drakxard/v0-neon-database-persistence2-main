import katex from "katex"

const mathDelimiters = [
  { open: "$$", close: "$$", display: true },
  { open: "\\[", close: "\\]", display: true },
  { open: "\\(", close: "\\)", display: false },
  { open: "$", close: "$", display: false },
] as const

function escaped(text: string, at: number) {
  let slashes = 0
  for (let index = at - 1; index >= 0 && text[index] === "\\"; index--) slashes++
  return slashes % 2 === 1
}

function mathAt(text: string, at: number) {
  if (escaped(text, at)) return null
  for (const delimiter of mathDelimiters) {
    if (!text.startsWith(delimiter.open, at)) continue
    if (delimiter.open === "$" && (text[at - 1] === "$" || text[at + 1] === "$")) continue
    for (let end = at + delimiter.open.length; end < text.length; end++) {
      if (!escaped(text, end) && text.startsWith(delimiter.close, end)) {
        if (delimiter.close === "$" && text[end + 1] === "$") continue
        return { ...delimiter, raw: text.slice(at, end + delimiter.close.length), body: text.slice(at + delimiter.open.length, end) }
      }
    }
  }
  return null
}

function appendInline(parent: HTMLElement, value: string) {
  let at = 0
  const appendText = (text: string) => { if (text) parent.append(document.createTextNode(text)) }
  while (at < value.length) {
    const math = mathAt(value, at)
    if (math) {
      const span = document.createElement("span")
      try { katex.render(math.body, span, { displayMode: math.display, throwOnError: false, strict: "ignore", trust: false }) }
      catch { span.textContent = math.raw }
      parent.append(span)
      at += math.raw.length
      continue
    }
    if (value[at] === "`") {
      const end = value.indexOf("`", at + 1)
      if (end > at + 1) {
        const code = document.createElement("code")
        code.textContent = value.slice(at + 1, end)
        parent.append(code)
        at = end + 1
        continue
      }
    }
    if (value.startsWith("**", at)) {
      const end = value.indexOf("**", at + 2)
      if (end > at + 2) {
        const strong = document.createElement("strong")
        appendInline(strong, value.slice(at + 2, end))
        parent.append(strong)
        at = end + 2
        continue
      }
    }
    if (value[at] === "[") {
      const labelEnd = value.indexOf("](http", at + 1)
      const urlEnd = labelEnd < 0 ? -1 : value.indexOf(")", labelEnd + 2)
      if (labelEnd > at && urlEnd > labelEnd) {
        const anchor = document.createElement("a")
        anchor.textContent = value.slice(at + 1, labelEnd)
        anchor.href = value.slice(labelEnd + 2, urlEnd)
        anchor.target = "_blank"
        anchor.rel = "noopener noreferrer"
        parent.append(anchor)
        at = urlEnd + 1
        continue
      }
    }
    let next = at + 1
    while (next < value.length && !"`$[".includes(value[next]) && !value.startsWith("**", next)) next++
    appendText(value.slice(at, next))
    at = next
  }
}

const tableCells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map(value => value.trim())
const tableRule = (line: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line)

export function renderSynthesisMarkdown(container: HTMLElement, source: string) {
  container.replaceChildren()
  const lines = String(source).replace(/\r\n?/g, "\n").split("\n")
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim()) { index++; continue }
    const fence = /^\s*```([^`]*)$/.exec(line)
    if (fence) {
      const values: string[] = []
      index++
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) values.push(lines[index++])
      if (index < lines.length) index++
      const pre = document.createElement("pre")
      const code = document.createElement("code")
      code.textContent = values.join("\n")
      pre.append(code); container.append(pre); continue
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) {
      const element = document.createElement(`h${heading[1].length}`)
      appendInline(element, heading[2]); container.append(element); index++; continue
    }
    if (index + 1 < lines.length && line.includes("|") && tableRule(lines[index + 1])) {
      const table = document.createElement("table")
      const thead = document.createElement("thead")
      const headRow = document.createElement("tr")
      tableCells(line).forEach(value => { const cell = document.createElement("th"); appendInline(cell, value); headRow.append(cell) })
      thead.append(headRow); table.append(thead); index += 2
      const tbody = document.createElement("tbody")
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        const row = document.createElement("tr")
        tableCells(lines[index++]).forEach(value => { const cell = document.createElement("td"); appendInline(cell, value); row.append(cell) })
        tbody.append(row)
      }
      table.append(tbody); container.append(table); continue
    }
    const list = /^\s*(?:[-+*]|\d+\.)\s+(.+)$/.exec(line)
    if (list) {
      const ordered = /^\s*\d+\./.test(line)
      const element = document.createElement(ordered ? "ol" : "ul")
      while (index < lines.length) {
        const item = /^\s*(?:[-+*]|\d+\.)\s+(.+)$/.exec(lines[index])
        if (!item || /^\s*\d+\./.test(lines[index]) !== ordered) break
        const child = document.createElement("li"); appendInline(child, item[1]); element.append(child); index++
      }
      container.append(element); continue
    }
    const paragraph: string[] = []
    while (index < lines.length && lines[index].trim()) {
      if (paragraph.length && (/^#{1,6}\s+/.test(lines[index]) || /^\s*```/.test(lines[index]) || /^\s*(?:[-+*]|\d+\.)\s+/.test(lines[index]))) break
      paragraph.push(lines[index++])
    }
    const element = document.createElement("p")
    appendInline(element, paragraph.join("\n")); container.append(element)
  }
}
