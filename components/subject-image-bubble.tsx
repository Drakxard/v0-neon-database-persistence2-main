"use client"

import { HandDrawnBubble } from "./hand-drawn-bubble"
import { usePdfLongPress } from "@/hooks/use-pdf-long-press"
import { voiceImageName } from "@/lib/subject-voice-search"
import type { VoiceImage } from "@/lib/subject-voice-images"

export function SubjectImageBubble({ image, color, disabled, open, remove, failed, topic = false }: {
  image: VoiceImage; color: string; disabled: boolean; open: () => void; remove: () => Promise<void>; failed: (error: unknown) => void; topic?: boolean
}) {
  const press = usePdfLongPress(async () => { if (!disabled) await remove() }, failed)
  return <HandDrawnBubble {...press} seed={image.id} color={color} disabled={disabled}
    data-voice-image-id={topic ? undefined : image.id} data-topic-image-id={topic ? image.id : undefined}
    title="Mantené presionado un segundo para borrar este globo" onClick={open}>{voiceImageName(image.name)}</HandDrawnBubble>
}
