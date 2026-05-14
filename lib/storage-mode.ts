export type AppStorageMode = "database" | "local"

export function getAppStorageMode(): AppStorageMode {
  return "local"
}

export function isLocalStorageMode() {
  return getAppStorageMode() === "local"
}

