import { Extension } from "@tiptap/core"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { ReplaceStep, ReplaceAroundStep, AddMarkStep, RemoveMarkStep } from "@tiptap/pm/transform"
import { createSynthesisId } from "@/lib/synthesis-workspace"

const TYPES = new Set(["heading", "listItem", "taskItem"])

export const StructuralId = Extension.create({
  name: "synthesisStructuralId",
  addGlobalAttributes() {
    return [{
      types: [...TYPES],
      attributes: {
        synthesisParentId: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-synthesis-parent-id"),
          renderHTML: (attributes) => attributes.synthesisParentId ? { "data-synthesis-parent-id": attributes.synthesisParentId } : {},
        },
        synthesisId: {
          default: null,
          parseHTML: (element) => element.getAttribute("data-synthesis-id"),
          renderHTML: (attributes) => attributes.synthesisId ? { "data-synthesis-id": attributes.synthesisId } : {},
        },
      },
    }]
  },
  addProseMirrorPlugins() {
    let initialized = false
    return [new Plugin({
      key: new PluginKey("synthesisStructuralIds"),
      appendTransaction: (transactions, _oldState, newState) => {
        if (!transactions.some(transaction => transaction.docChanged)) return null
        // Typing and formatting text cannot create duplicate structural IDs.
        // Pasting/splitting headings or list items still requires validation.
        const structuralChange = transactions.some(transaction => transaction.steps.some(step => {
          if (step instanceof AddMarkStep || step instanceof RemoveMarkStep) return false
          if (!(step instanceof ReplaceStep || step instanceof ReplaceAroundStep)) return true
          let structural = false
          step.slice.content.descendants(node => {
            if (TYPES.has(node.type.name)) structural = true
            return !structural
          })
          return structural
        }))
        if (initialized && !structuralChange) return null
        initialized = true
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
