// Keep ProseMirror's live document as the source of truth. Serialize only after
// a typing pause (or a bounded interval), and synchronously before saving/leaving.
export function createDeferredEditorChange<T>(read: () => T, emit: (value: T) => void, onPending: () => void,
  pauseMs = 350, maxMs = 1500) {
  let pending = false
  let pauseTimer: ReturnType<typeof setTimeout> | undefined
  let maxTimer: ReturnType<typeof setTimeout> | undefined
  const clear = () => { clearTimeout(pauseTimer); clearTimeout(maxTimer); pauseTimer = undefined; maxTimer = undefined }
  const flush = () => {
    clear()
    if (!pending) return
    const value = read()
    pending = false
    try { emit(value) } catch (error) { pending = true; throw error }
  }
  return {
    flush,
    get pending() { return pending },
    markDirty() {
      if (!pending) { pending = true; onPending() }
      clearTimeout(pauseTimer)
      pauseTimer = setTimeout(flush, pauseMs)
      maxTimer ??= setTimeout(flush, maxMs)
    },
  }
}
