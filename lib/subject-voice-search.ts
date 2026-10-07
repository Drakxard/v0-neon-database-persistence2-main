import type { VoiceImage, VoiceImageGroup } from "./subject-voice-images"

export type VoiceImageMatch = { image: VoiceImage; group: VoiceImageGroup }

function words(text: string) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().match(/[a-z0-9]+/g) ?? []
}

function variants(word: string) {
  const forms = new Set([word])
  if (word.length > 3 && word.endsWith("s")) forms.add(word.slice(0, -1))
  if (word.length > 4 && word.endsWith("es")) forms.add(word.slice(0, -2))
  return [...forms].map((form) => form === "teo" ? "teorema" : form)
}

export function voiceImageName(name: string) { return name.replace(/\.[^.]+$/, "") || name }

export function searchVoiceImages(groups: VoiceImageGroup[], query: string): VoiceImageMatch[] {
  const terms = words(query).map(variants)
  if (!terms.length) return []
  return groups.flatMap((group) => group.images.filter((image) => {
    const tokens = words(voiceImageName(image.name)).flatMap(variants)
    return terms.every((term) => term.some((form) => tokens.some((token) => token.includes(form))))
  }).map((image) => ({ image, group })))
}

export function voiceGroupDiameter(count: number) { return Math.min(320, Math.max(160, 120 + 40 * Math.sqrt(count))) }
