import { neon } from "@neondatabase/serverless"

import type { MaterialTagRegion } from "@/lib/study-types"

const database = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null

function getDatabase() {
  if (!database) throw new Error("DATABASE_URL is not configured.")
  return database
}

type RegionRow = {
  id: number | string
  material_id: number | string
  tag_id: number | string
  page_number: number | string
  page_rotation: number | string
  x1: number | string
  y1: number | string
  x2: number | string
  y2: number | string
  order_index: number | string
  created_at: string | Date
  updated_at: string | Date
}

function mapRegion(row: RegionRow): MaterialTagRegion {
  return {
    id: Number(row.id),
    materialId: Number(row.material_id),
    tagId: Number(row.tag_id),
    pageNumber: Number(row.page_number),
    pageRotation: Number(row.page_rotation),
    x1: Number(row.x1),
    y1: Number(row.y1),
    x2: Number(row.x2),
    y2: Number(row.y2),
    orderIndex: Number(row.order_index),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  }
}

export function normalizeMaterialTagRegions(
  materialId: number,
  tagId: number,
  input: unknown
): MaterialTagRegion[] {
  if (!Array.isArray(input)) throw new Error("REGIONS_INVALID")
  return input.map((candidate, orderIndex) => {
    const region = candidate as Partial<MaterialTagRegion>
    const pageNumber = Number(region.pageNumber)
    const pageRotation = Number(region.pageRotation ?? 0)
    const x1 = Number(region.x1)
    const y1 = Number(region.y1)
    const x2 = Number(region.x2)
    const y2 = Number(region.y2)
    if (
      !Number.isInteger(pageNumber) || pageNumber < 1 ||
      ![0, 90, 180, 270].includes(pageRotation) ||
      ![x1, y1, x2, y2].every((value) => Number.isFinite(value) && value >= 0 && value <= 1) ||
      Math.abs(x2 - x1) < 0.005 ||
      Math.abs(y2 - y1) < 0.005
    ) {
      throw new Error("REGIONS_INVALID")
    }
    return { materialId, tagId, pageNumber, pageRotation, x1, y1, x2, y2, orderIndex }
  })
}

export async function listMaterialTagRegions(materialId: number, tagId: number) {
  const sql = getDatabase()
  const rows = await sql`
    SELECT id, material_id, tag_id, page_number, page_rotation,
           x1, y1, x2, y2, order_index, created_at, updated_at
    FROM material_tag_regions
    WHERE material_id = ${materialId} AND tag_id = ${tagId}
    ORDER BY order_index, id
  ` as RegionRow[]
  return rows.map(mapRegion)
}

export async function replaceMaterialTagRegions(
  materialId: number,
  tagId: number,
  regions: MaterialTagRegion[]
) {
  const sql = getDatabase()
  const assignment = await sql`
    SELECT 1
    FROM subject_day_material_tags
    WHERE material_id = ${materialId} AND tag_id = ${tagId}
    LIMIT 1
  `
  if (!assignment[0]) throw new Error("TAG_ASSIGNMENT_NOT_FOUND")

  await sql`DELETE FROM material_tag_regions WHERE material_id = ${materialId} AND tag_id = ${tagId}`
  for (const region of regions) {
    await sql`
      INSERT INTO material_tag_regions (
        material_id, tag_id, page_number, page_rotation,
        x1, y1, x2, y2, order_index
      ) VALUES (
        ${materialId}, ${tagId}, ${region.pageNumber}, ${region.pageRotation},
        ${region.x1}, ${region.y1}, ${region.x2}, ${region.y2}, ${region.orderIndex}
      )
    `
  }
  return listMaterialTagRegions(materialId, tagId)
}

export async function clearMaterialTagRegions(materialId: number) {
  const sql = getDatabase()
  const rows = await sql`
    DELETE FROM material_tag_regions WHERE material_id = ${materialId}
    RETURNING id
  `
  return rows.length
}
