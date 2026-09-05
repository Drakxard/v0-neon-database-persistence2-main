import { Extension } from "@tiptap/core"
import { Plugin } from "@tiptap/pm/state"
import { deleteSynthesisImage, localImageId, saveSynthesisImage } from "@/lib/client/synthesis-images"
import { referencedLocalImageIds } from "@/lib/synthesis-workspace"

export const LocalImagePaste = Extension.create<{ onError: (message: string) => void }>({
  name: "localImagePaste",
  addOptions() { return { onError: () => {} } },
  addProseMirrorPlugins() {
    const editor = this.editor
    const onError = this.options.onError
    return [new Plugin({
      props: {
        handlePaste: (_view, event) => {
          if (!editor.isEditable || !event.clipboardData) return false
          const data = event.clipboardData
          // Copies made inside the editor already contain persistent image references.
          if (data.getData("text/html").includes("synthesis-local-image:")) return false
          const items = Array.from(data.items).filter((item) => item.kind === "file" && item.type.startsWith("image/"))
          const files = items.length
            ? items.map((item) => item.getAsFile()).filter((file): file is File => Boolean(file))
            : Array.from(data.files).filter((file) => file.type.startsWith("image/"))
          if (!files.length) return false
          event.preventDefault()
          let bookmark = editor.state.selection.getBookmark()
          const track = ({ transaction }: { transaction: typeof editor.state.tr }) => { bookmark = bookmark.map(transaction.mapping) }
          editor.on("transaction", track)
          void (async () => {
            const saved: string[] = []
            try {
              const results = await Promise.allSettled(files.map((file) => saveSynthesisImage(file)))
              for (const result of results) if (result.status === "fulfilled") saved.push(result.value)
              const failure = results.find((result) => result.status === "rejected")
              if (failure?.status === "rejected") throw failure.reason
              if (editor.isDestroyed) return
              const selection = bookmark.resolve(editor.state.doc)
              const inserted = editor.commands.insertContentAt(
                { from: selection.from, to: selection.to },
                saved.map((src) => ({ type: "image", attrs: { src } })),
                { updateSelection: editor.state.selection.eq(selection) },
              )
              if (!inserted) throw new Error("No se pudo pegar la imagen en esta posición.")
              saved.length = 0
            } catch (error) {
              if (!editor.isDestroyed) onError(error instanceof Error ? error.message : "No se pudo pegar la imagen.")
            } finally {
              editor.off("transaction", track)
              const referenced = new Set(editor.isDestroyed ? [] : referencedLocalImageIds(editor.getJSON()))
              await Promise.allSettled(saved.map(localImageId).filter((id): id is string => Boolean(id) && !referenced.has(id!)).map(deleteSynthesisImage))
            }
          })()
          return true
        },
      },
    })]
  },
})
