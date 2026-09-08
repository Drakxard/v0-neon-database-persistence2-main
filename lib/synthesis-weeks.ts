import { parseSynthesisContext } from "./synthesis-context.ts"

export function synthesisWeeksFromObjects(subjectId: string, objects: Array<{ key: string; lastModified: string | null }>) {
  const context = parseSynthesisContext(subjectId, 0)
  const prefix = "manifests/inscreen/sintesis/by-subject/" + context.subjectId + "/"
  const weeks = new Map<number, { weekNumber: number; updatedAt: string | null }>()
  for (const object of objects) {
    if (!object.key.startsWith(prefix)) continue
    const match = /^semana-(0|[1-9][0-9]*)\/synthesis-v2\.json$/.exec(object.key.slice(prefix.length))
    if (!match) continue
    const weekNumber = Number(match[1])
    if (weekNumber > 9999) continue
    weeks.set(weekNumber, { weekNumber, updatedAt: object.lastModified })
  }
  return [...weeks.values()].sort((a, b) => b.weekNumber - a.weekNumber)
}
