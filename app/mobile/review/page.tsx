import { MobileReviewClient } from "@/app/mobile/review/mobile-review-client"
import { buildMobileReviewSignedQuery, verifyMobileReviewSignature } from "@/lib/mobile-review-auth"
import { getMobileReviewStatus, isMissingMobileReviewDependency, resolveMobileReviewPair, withSignedAudioUrls } from "@/lib/mobile-review"

export const dynamic = "force-dynamic"

export default async function MobileReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const deviceId = typeof params.device === "string" ? params.device.trim() : ""
  const signature = typeof params.sig === "string" ? params.sig.trim() : ""

  if (!deviceId || !verifyMobileReviewSignature(deviceId, signature)) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f1e4a9] p-6 text-center text-black">
        <div className="max-w-sm border-4 border-black bg-[#f1e4a9] px-6 py-8">
          <p className="text-2xl">Acceso invalido</p>
        </div>
      </main>
    )
  }

  try {
    const resolved = await resolveMobileReviewPair({ deviceId })
    const authQuery = buildMobileReviewSignedQuery(deviceId)
    const initialPayload = {
      pair: resolved.pair ? withSignedAudioUrls(resolved.pair, authQuery) : null,
      status: await getMobileReviewStatus(deviceId),
    }

    return (
      <MobileReviewClient
        deviceId={deviceId}
        signature={signature}
        initialPayload={initialPayload}
        initialError=""
      />
    )
  } catch (error) {
    const message = isMissingMobileReviewDependency(error)
      ? "Faltan migraciones de mobile review en Neon."
      : error instanceof Error
        ? error.message
        : "No se pudo abrir el repaso movil."

    return (
      <MobileReviewClient
        deviceId={deviceId}
        signature={signature}
        initialPayload={{
          pair: null,
          status: await getMobileReviewStatus(deviceId).catch(() => ({
            deviceId,
            activeSlot: null,
            subjectId: null,
            subjectName: null,
            weekNumber: 0,
            hasCurrentPair: false,
            currentPairId: null,
          })),
        }}
        initialError={message}
      />
    )
  }
}
