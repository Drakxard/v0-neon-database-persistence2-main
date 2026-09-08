/** Marks a save complete only after the directory write and verification finish. */
export function createAsyncLocalAutosave(write: () => Promise<void>, onStatus: (status: "pending" | "saved" | "error") => void) {
  let version = 0
  let savedVersion = 0
  let running: Promise<boolean> | null = null
  let pauseTimer: ReturnType<typeof setTimeout> | undefined
  let maxTimer: ReturnType<typeof setTimeout> | undefined
  const clearTimers = () => { clearTimeout(pauseTimer); clearTimeout(maxTimer); pauseTimer = undefined; maxTimer = undefined }
  const flush = (): Promise<boolean> => {
    clearTimers()
    if (running) return running
    const task = (async () => {
      try {
        while (savedVersion !== version) {
          const target = version
          await write()
          savedVersion = target
        }
        onStatus("saved")
        return true
      } catch { onStatus("error"); return false }
    })()
    running = task.finally(() => { running = null })
    return running
  }
  return {
    get dirty() { return savedVersion !== version },
    flush,
    markDirty() {
      version++
      onStatus("pending")
      clearTimeout(pauseTimer)
      pauseTimer = setTimeout(() => { void flush() }, 800)
      maxTimer ??= setTimeout(() => { void flush() }, 5000)
    },
  }
}
