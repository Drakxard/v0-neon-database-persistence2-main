// TTS uses remote providers even when course materials live in a local folder.
export function isTtsServerRequest(pathname: string, method: string) {
  return pathname === "/api/tts" && method.toUpperCase() === "POST"
}
