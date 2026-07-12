export type AppStorageMode = "database" | "local"

export function getAppStorageMode(): AppStorageMode {
  const configuredMode = process.env.APP_STORAGE_MODE?.trim().toLowerCase()
  if (configuredMode === "local" || configuredMode === "database") {
    return configuredMode
  }

  return process.env.DATABASE_URL ? "database" : "local"
}

export function isLocalStorageMode() {
  return getAppStorageMode() === "local"
}

