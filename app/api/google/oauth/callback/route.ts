import { oauthStateCookie, sealDriveUserConfig, verifyOAuthState } from "@/lib/drive-user-config"
import { getInscreenConfigSeedFingerprint } from "@/lib/inscreen-user-config"
import { ensureUserDriveFolder, getUserDriveIdentity } from "@/lib/google-drive"
import { exchangeCodeForRefreshToken } from "@/lib/google-oauth"

export const runtime = "nodejs"

function popupPage(payload: Record<string, unknown>, headers?: HeadersInit, status = 200) {
  const serialized = JSON.stringify(payload).replace(/</g, "\\u003c")
  const responseHeaders = new Headers(headers)
  responseHeaders.set("Content-Type", "text/html; charset=utf-8")
  responseHeaders.set("Cache-Control", "no-store")
  return new Response(`<!doctype html><html><body><p>Finalizando conexion con Google Drive...</p><script>const data=${serialized};if(window.opener){window.opener.postMessage(data,window.location.origin);window.close()}else{document.body.textContent=data.error||"Drive conectado. Ya podes cerrar esta ventana."}</script></body></html>`, { status, headers: responseHeaders })
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get("code") || ""
  const state = url.searchParams.get("state") || ""
  const oauthError = url.searchParams.get("error")
  if (oauthError) return popupPage({ type: "drive-oauth", ok: false, error: oauthError }, undefined, 400)
  if (!code || !verifyOAuthState(request, state)) return popupPage({ type: "drive-oauth", ok: false, error: "La sesion OAuth es invalida o vencio." }, undefined, 400)
  try {
    const token = await exchangeCodeForRefreshToken(code)
    if (!token.refresh_token) throw new Error("Google no devolvio un refresh token. Repeti la conexion.")
    const rootFolderName = process.env.GOOGLE_DRIVE_ROOT_FOLDER_NAME || "Cursado2026"
    const [identity, root] = await Promise.all([getUserDriveIdentity(token.refresh_token), ensureUserDriveFolder(token.refresh_token, rootFolderName, "root")])
    const email = String(identity.user?.emailAddress || "").trim()
    if (!email) throw new Error("Google Drive no devolvio la cuenta conectada.")
    const rootFolderLink = root.webViewLink || `https://drive.google.com/drive/folders/${root.id}`
    const driveToken = sealDriveUserConfig({ refreshToken: token.refresh_token, rootFolderId: root.id, rootFolderName, rootFolderLink, email })
    const headers = new Headers()
    headers.append("Set-Cookie", oauthStateCookie("", 0))
    return popupPage({ type: "drive-oauth", ok: true, driveToken, seedFingerprint: getInscreenConfigSeedFingerprint(), email, rootFolderName, rootFolderLink }, headers)
  } catch (error) {
    return popupPage({ type: "drive-oauth", ok: false, error: error instanceof Error ? error.message : "No se pudo conectar Google Drive." }, undefined, 500)
  }
}
