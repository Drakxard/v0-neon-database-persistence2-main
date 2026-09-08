import { createSynthesisFolderStore } from "../../lib/client/synthesis-folder-store.ts"

export function folderFixture() {
  const files = new Map<string, Blob>()
  const directories = new Set<string>([""])
  let fail: ((path: string) => boolean) | null = null
  let corrupt: ((path: string) => boolean) | null = null
  const absent = () => new DOMException("Missing file", "NotFoundError")
  const dir = (path: string): FileSystemDirectoryHandle => ({
    kind: "directory", name: path.split("/").at(-1) ?? "test",
    async getDirectoryHandle(name: string, options?: { create?: boolean }) {
      const child = [path, name].filter(Boolean).join("/")
      if (!directories.has(child) && !options?.create) throw absent()
      directories.add(child)
      return dir(child)
    },
    async getFileHandle(name: string, options?: { create?: boolean }) {
      const child = [path, name].filter(Boolean).join("/")
      if (!files.has(child)) {
        if (!options?.create) throw absent()
        files.set(child, new Blob([]))
      }
      return {
        kind: "file", name,
        async getFile() { return new File([files.get(child)!], name, { type: files.get(child)!.type }) },
        async createWritable() {
          let staged = files.get(child)!
          return {
            async write(value: Blob | string) { staged = typeof value === "string" ? new Blob([value]) : value },
            async close() {
              if (fail?.(child)) throw new DOMException("Permission revoked", "NotAllowedError")
              files.set(child, corrupt?.(child) ? new Blob(["bad readback"]) : staged)
            },
            async abort() {},
          }
        },
      }
    },
    async *entries() {
      const prefix = path ? path + "/" : ""
      for (const child of directories) {
        if (child.startsWith(prefix) && child !== path && !child.slice(prefix.length).includes("/")) yield [child.slice(prefix.length), dir(child)]
      }
      for (const child of files.keys()) {
        if (child.startsWith(prefix) && !child.slice(prefix.length).includes("/")) yield [child.slice(prefix.length), await dir(path).getFileHandle(child.slice(prefix.length))]
      }
    },
  }) as unknown as FileSystemDirectoryHandle
  const root = dir("")
  return { root, files, store: createSynthesisFolderStore(root),
    failWrites: (predicate: ((path: string) => boolean) | null) => { fail = predicate },
    corruptWrites: (predicate: ((path: string) => boolean) | null) => { corrupt = predicate },
    reopen: () => createSynthesisFolderStore(root),
  }
}

export function browserStorage(values = new Map<string, string>()): Storage {
  return { get length() { return values.size }, key: (index) => [...values.keys()][index] ?? null,
    getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) },
    removeItem: (key) => { values.delete(key) }, clear: () => values.clear() }
}
