export type InscreenProviderFileKind = "pagina" | "transcripcion"
type ProviderObject = { key: string }

type ParsedObject = {
  object: ProviderObject
  stage: number
  number: number
  name: string
}

export function selectIncrementalProviderObjects(
  objects: ProviderObject[],
  subjectSegment: string,
  kind: InscreenProviderFileKind,
  lastFile: string | null
) {
  const root = `InSreen/${subjectSegment}/`
  const escapedRoot = root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const pattern = new RegExp(`^${escapedRoot}(\\d+)/${kind}/([1-9][0-9]*)\\.txt$`)
  const parsed: ParsedObject[] = objects.flatMap((object) => {
    const match = pattern.exec(object.key)
    return match ? [{ object, stage: Number(match[1]), number: Number(match[2]), name: `${match[2]}.txt` }] : []
  })
  const stages = [...new Set(parsed.map((file) => file.stage))].sort((left, right) => left - right)
  const filesAt = (stage: number) => parsed.filter((file) => file.stage === stage).sort((left, right) => left.number - right.number)
  const latestStage = stages.at(-1) ?? 0
  if (!latestStage) return { currentStage: 0, files: [] as ProviderObject[], newStage: null }

  const latest = filesAt(latestStage)
  if (!lastFile) {
    return { currentStage: 0, files: [] as ProviderObject[], newStage: { stage: latestStage, files: latest.map((file) => file.object) } }
  }

  const latestCursor = latest.find((file) => file.name === lastFile)
  if (latestCursor) {
    return {
      currentStage: latestStage,
      files: latest.filter((file) => file.number > latestCursor.number).map((file) => file.object),
      newStage: null,
    }
  }

  const previousStage = stages.at(-2) ?? latestStage
  const previous = filesAt(previousStage)
  const previousCursor = previous.find((file) => file.name === lastFile)
  const pending = previousCursor
    ? previous.filter((file) => file.number > previousCursor.number).map((file) => file.object)
    : []
  const isWeeklyRollover = previousStage !== latestStage && latest[0]?.number === 1
  return {
    currentStage: previousStage,
    files: pending,
    newStage: isWeeklyRollover ? { stage: latestStage, files: latest.map((file) => file.object) } : null,
  }
}
