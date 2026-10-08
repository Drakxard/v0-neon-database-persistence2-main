import { Node, mergeAttributes } from "@tiptap/core"
import { Plugin } from "@tiptap/pm/state"
import { Fragment, Slice } from "@tiptap/pm/model"
import katex from "katex"
import { normalizeSynthesisMath } from "@/lib/synthesis-math"

export const SynthesisMath = Node.create({
  name: "synthesisMath",
  priority: 1000,
  inline: true,
  group: "inline",
  atom: true,
  addAttributes() {
    return {
      latex: {default:"",parseHTML:element => element.getAttribute("data-latex")},
      display: {default:false,parseHTML:element => element.getAttribute("data-display") === "true"},
    }
  },
  parseHTML() { return [{tag:"span[data-synthesis-math]"}] },
  renderHTML({node, HTMLAttributes}) {
    return ["span", mergeAttributes(HTMLAttributes, {"data-synthesis-math":"", "data-latex":node.attrs.latex,"data-display":String(node.attrs.display)}), node.attrs.latex]
  },
  renderText({node}) { return node.attrs.display ? `\\[${node.attrs.latex}\\]` : `\\(${node.attrs.latex}\\)` },
  addNodeView() {
    return ({node}) => {
      const dom = document.createElement("span")
      dom.dataset.synthesisMath = ""
      dom.dataset.latex = node.attrs.latex
      dom.dataset.display = String(node.attrs.display)
      dom.contentEditable = "false"
      dom.setAttribute("aria-label", node.attrs.latex)
      dom.style.maxWidth = "100%"
      dom.style.overflowX = "auto"
      if (node.attrs.display) dom.style.display = "block"
      katex.render(node.attrs.latex, dom, {displayMode:node.attrs.display,throwOnError:false,trust:false,strict:"ignore"})
      return {dom}
    }
  },
  addProseMirrorPlugins() {
    const schema = this.editor.schema
    return [new Plugin({props:{
      transformPastedHTML(html) {
        const parsed = new DOMParser().parseFromString(html, "text/html")
        for (const element of parsed.querySelectorAll(".katex-display, .katex, math")) {
          if (!parsed.body.contains(element)) continue
          const latex = element.querySelector('annotation[encoding="application/x-tex"]')?.textContent
          if (!latex?.trim()) continue
          const span = parsed.createElement("span")
          span.dataset.synthesisMath = ""; span.dataset.latex = latex
          span.dataset.display = String(element.classList.contains("katex-display") || element.getAttribute("display") === "block")
          span.textContent = latex
          element.replaceWith(span)
        }
        return parsed.body.innerHTML
      },
      transformPasted(slice) {
        const normalized = normalizeSynthesisMath({type:"doc",content:slice.content.toJSON()})
        return new Slice(Fragment.fromJSON(schema, normalized.content ?? []),slice.openStart,slice.openEnd)
      },
    }})]
  },
})
