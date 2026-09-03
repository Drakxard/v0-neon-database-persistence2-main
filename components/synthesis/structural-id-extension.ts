import { Extension } from "@tiptap/core"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { createSynthesisId } from "@/lib/synthesis-workspace"

const TYPES = new Set(["heading", "listItem", "taskItem"])

export const StructuralId = Extension.create({
  name: "synthesisStructuralId",
  addGlobalAttributes() {
    return [{
      types: [...TYPES],
      attributes: {
        synthesisId: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-synthesis-id"),
          renderHTML: (attributes) => attributes.synthesisId ? { "data-synthesis-id": attributes.synthesisId } : {},
        },
      },
    }]
  },
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey("synthesisStructuralIds"),
      appendTransaction: (_transactions, _oldState, newState) => {
        const seen = new Set<string>()
        let transaction = newState.tr
        let changed = false
        newState.doc.descendants((node, pos) => {
          if (!TYPES.has(node.type.name)) return true
          const current = typeof node.attrs.synthesisId === "string" ? node.attrs.synthesisId : ""
          if (current && !seen.has(current)) { seen.add(current); return true }
          const synthesisId = createSynthesisId()
          seen.add(synthesisId)
          transaction = transaction.setNodeMarkup(pos, undefined, { ...node.attrs, synthesisId })
          changed = true
          return true
        })
        return changed ? transaction : null
      },
    })]
  },
})
