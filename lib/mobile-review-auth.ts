import { createHmac, timingSafeEqual } from "node:crypto"

function requireEnv(name: string) {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`)
  }
  return value
}

export function getMobileReviewConfig() {
  return {
    secret: requireEnv("MOBILE_REVIEW_SECRET"),
  }
}

export function signMobileReviewDevice(deviceId: string) {
  const normalizedDeviceId = String(deviceId || "").trim()
  if (!normalizedDeviceId) return ""
  const { secret } = getMobileReviewConfig()
  return createHmac("sha256", secret).update(normalizedDeviceId).digest("hex")
}

export function verifyMobileReviewSignature(deviceId: string, signature: string) {
  const normalizedDeviceId = String(deviceId || "").trim()
  const normalizedSignature = String(signature || "").trim()
  if (!normalizedDeviceId || !normalizedSignature) return false

  const expected = signMobileReviewDevice(normalizedDeviceId)
  const expectedBuffer = Buffer.from(expected, "utf8")
  const providedBuffer = Buffer.from(normalizedSignature, "utf8")
  if (expectedBuffer.length !== providedBuffer.length) return false
  return timingSafeEqual(expectedBuffer, providedBuffer)
}

export function buildMobileReviewSignedQuery(deviceId: string) {
  const normalizedDeviceId = String(deviceId || "").trim()
  const signature = signMobileReviewDevice(normalizedDeviceId)
  return new URLSearchParams({
    device: normalizedDeviceId,
    sig: signature,
  }).toString()
}
