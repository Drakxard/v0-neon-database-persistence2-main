import { Extension } from "@tiptap/core"
import { Plugin } from "@tiptap/pm/state"
import { cleanSynthesisPaste } from "@/lib/synthesis-paste"

export const CleanReferencePaste = Extension.create({
  name: "cleanReferencePaste",
  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        transformPasted: (slice) => cleanSynthesisPaste(slice),
      },
    })]
  },
})
