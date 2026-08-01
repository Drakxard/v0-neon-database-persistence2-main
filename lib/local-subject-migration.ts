export function addFileNameSuffix(fileName: string, suffix: number) {
  const dotIndex = fileName.lastIndexOf(".")
  if (dotIndex <= 0) return `${fileName} (${suffix})`
  return `${fileName.slice(0, dotIndex)} (${suffix})${fileName.slice(dotIndex)}`
}

export async function chooseNonOverwritingFileName<T>(input: {
  requestedName: string
  source: T
  readExisting: (name: string) => Promise<T | null>
  hasSameContent: (left: T, right: T) => Promise<boolean>
}) {
  let suffix = 1
  while (true) {
    const candidate = suffix === 1 ? input.requestedName : addFileNameSuffix(input.requestedName, suffix)
    const existing = await input.readExisting(candidate)
    if (!existing) return { name: candidate, alreadyCopied: false }
    if (await input.hasSameContent(input.source, existing)) {
      return { name: candidate, alreadyCopied: true }
    }
    suffix += 1
  }
}
