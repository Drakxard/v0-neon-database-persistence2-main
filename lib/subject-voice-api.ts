// These operations use remote providers even when the PDF workspace is local.
export function isSubjectVoiceServerRequest(pathname: string, method: string) {
  const verb = method.toUpperCase()
  if (pathname === "/api/subject-voice") return verb === "GET"
  if (pathname === "/api/subject-voice/pdf-extraction") return verb === "GET" || verb === "POST"
  if (pathname === "/api/subject-voice/pdf-evaluate" || pathname === "/api/subject-voice/pdf-refine") return verb === "POST"
  return false
}
