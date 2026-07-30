import { RegionPresentationClient } from "./region-presentation-client"

export const dynamic = "force-dynamic"

export default async function RegionPresentationPage({
  searchParams,
}: {
  searchParams: Promise<{ materialId?: string; tagIds?: string }>
}) {
  const params = await searchParams
  const materialId = Number(params.materialId)
  const tagIds = String(params.tagIds || "")
    .split(",")
    .map(Number)
    .filter(Number.isInteger)

  return <RegionPresentationClient materialId={materialId} requestedTagIds={tagIds} />
}
