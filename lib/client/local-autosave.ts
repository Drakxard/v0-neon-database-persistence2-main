/** Batches local writes and retains pending changes when storage rejects a write. */
export function createLocalAutosave(write: () => void, onStatus: (status: "pending" | "saved" | "error") => void) {
  let dirty = false
  let pauseTimer: ReturnType<typeof setTimeout> | undefined
  let maxTimer: ReturnType<typeof setTimeout> | undefined
  const clearTimers = () => {
    clearTimeout(pauseTimer)
    clearTimeout(maxTimer)
    pauseTimer = undefined
    maxTimer = undefined
  }
  const flush = () => {
    clearTimers()
    if (!dirty) return true
    try {
      write()
      dirty = false
      onStatus("saved")
      return true
    } catch {
      onStatus("error")
      return false
    }
  }
  return {
    get dirty() { return dirty },
    flush,
    markDirty() {
      dirty = true
      onStatus("pending")
      clearTimeout(pauseTimer)
      pauseTimer = setTimeout(flush, 800)
      maxTimer ??= setTimeout(flush, 5000)
    },
  }
}
