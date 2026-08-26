import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import { driveConfigCookie, readDriveUserConfig, splitDriveUserConfig } from "../lib/drive-user-config.ts"

test("User.Drive separa y cifra la cuenta sin exponer el refresh token", () => {
  const previousSeed = process.env.INSCREEN_CONFIG_SEED
  const previousNodeEnv = process.env.NODE_ENV
  try {
    process.env.INSCREEN_CONFIG_SEED = "seed-de-prueba-con-mas-de-treinta-y-dos-caracteres"
    process.env.NODE_ENV = "production"
    const config = { refreshToken: "refresh-super-secreto", rootFolderId: "root-id", rootFolderName: "Cursado2026", rootFolderLink: "https://drive.google.com/drive/folders/root-id", email: "user@example.com" }
    const halves = splitDriveUserConfig(config)
    assert.doesNotMatch(halves.fileHalf, /refresh-super-secreto/)
    assert.doesNotMatch(halves.cookieHalf, /refresh-super-secreto/)
    assert.match(driveConfigCookie(halves.cookieHalf), /HttpOnly; SameSite=Strict; Max-Age=31536000; Secure/)
    const request = new Request("https://example.test", { headers: { "x-drive-config-half": halves.fileHalf, Cookie: `drive_config_b=${encodeURIComponent(halves.cookieHalf)}` } })
    assert.deepEqual(readDriveUserConfig(request), config)
  } finally {
    if (previousSeed === undefined) delete process.env.INSCREEN_CONFIG_SEED
    else process.env.INSCREEN_CONFIG_SEED = previousSeed
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previousNodeEnv
  }
})

test("la replica usa materia, semana y contenedor sin crear carpeta por dia", () => {
  const drive = readFileSync(new URL("../lib/google-drive.ts", import.meta.url), "utf8")
  const replica = drive.slice(drive.indexOf("export async function createUserDriveUploadSession"), drive.indexOf("export async function deleteUserDriveFile"))
  assert.match(replica, /`Semana \$\{params\.weekNumber\}`/)
  assert.match(replica, /params\.containerName/)
  assert.doesNotMatch(replica, /weekdayIndex|WEEKDAY_NAMES|Dia /)
})
