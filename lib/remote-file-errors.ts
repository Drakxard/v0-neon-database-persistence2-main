export class RemoteFileNotFoundError extends Error {
  provider: "r2" | "drive"
  remoteId: string

  constructor(provider: "r2" | "drive", remoteId: string, message?: string) {
    super(message || "The remote file was not found.")
    this.name = "RemoteFileNotFoundError"
    this.provider = provider
    this.remoteId = remoteId
  }
}

export function isRemoteFileNotFoundError(error: unknown): error is RemoteFileNotFoundError {
  return error instanceof RemoteFileNotFoundError
}
