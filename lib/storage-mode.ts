export type AppStorageMode = "database" | "local"

export function getAppStorageMode(): AppStorageMode {
  const rawValue = String(process.env.APP_STORAGE_MODE || "database").trim().toLowerCase()
  return rawValue === "local" ? "local" : "database"
}

export function isLocalStorageMode() {
  return getAppStorageMode() === "local"
}

