import { neon } from "@neondatabase/serverless"

import type { MaterialTagWorkspace, StudyTag } from "@/lib/study-types"
import {
  normalizeTagColor,
  normalizeTagDisplayName,
  normalizeTagName,
} from "@/lib/tag-utils"

const database = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null

type TagRow = {
  id: number | string
  name: string
  normalized_name: string
  color: string
  parent_id: number | string | null
  usage_count: number | string
  created_at: string | Date
  updated_at: string | Date
}

function getDatabase() {
  if (!database) {
    throw new Error("DATABASE_URL is not configured.")
  }
  return database
}

function toIso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : String(value)
}

function mapTag(row: TagRow): StudyTag {
  return {
    id: Number(row.id),
    name: row.name,
    normalizedName: row.normalized_name,
    color: row.color,
    parentId: row.parent_id == null ? null : Number(row.parent_id),
    usageCount: Number(row.usage_count || 0),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  }
}

async function getTagRow(tagId: number) {
  const sql = getDatabase()
  const rows = await sql`
    SELECT
      t.id,
      t.name,
      t.normalized_name,
      t.color,
      t.parent_id,
      COUNT(smt.material_id)::int AS usage_count,
      t.created_at,
      t.updated_at
    FROM tags t
    LEFT JOIN subject_day_material_tags smt ON smt.tag_id = t.id
    WHERE t.id = ${tagId}
    GROUP BY t.id
    LIMIT 1
  ` as TagRow[]
  return rows[0] ? mapTag(rows[0]) : null
}

async function assertParentIsValid(tagId: number | null, parentId: number | null) {
  if (parentId == null) return
  if (tagId != null && tagId === parentId) {
    throw new Error("TAG_PARENT_CYCLE")
  }

  const sql = getDatabase()
  const parentRows = await sql`SELECT id FROM tags WHERE id = ${parentId} LIMIT 1`
  if (!parentRows[0]) throw new Error("TAG_PARENT_NOT_FOUND")
  if (tagId == null) return

  const descendantRows = await sql`
    WITH RECURSIVE descendants AS (
      SELECT id FROM tags WHERE parent_id = ${tagId}
      UNION ALL
      SELECT t.id
      FROM tags t
      INNER JOIN descendants d ON t.parent_id = d.id
    )
    SELECT id FROM descendants WHERE id = ${parentId} LIMIT 1
  `
  if (descendantRows[0]) throw new Error("TAG_PARENT_CYCLE")
}

export async function listMaterialTagWorkspace(scope: {
  subjectId: string
  weekNumber?: number
  sessionDate?: string
}): Promise<MaterialTagWorkspace> {
  const sql = getDatabase()
  const tagRows = await sql`
    SELECT
      t.id,
      t.name,
      t.normalized_name,
      t.color,
      t.parent_id,
      COUNT(smt.material_id)::int AS usage_count,
      t.created_at,
      t.updated_at
    FROM tags t
    LEFT JOIN subject_day_material_tags smt ON smt.tag_id = t.id
    GROUP BY t.id
    ORDER BY t.name ASC, t.id ASC
  ` as TagRow[]

  let assignmentRows: Array<{ material_id: number; tag_id: number }>
  if (scope.sessionDate) {
    assignmentRows = await sql`
      SELECT smt.material_id, smt.tag_id
      FROM subject_day_material_tags smt
      INNER JOIN subject_day_materials m ON m.id = smt.material_id
      WHERE m.subject_id = ${scope.subjectId}
        AND m.session_date = ${scope.sessionDate}
      ORDER BY smt.material_id, smt.tag_id
    ` as Array<{ material_id: number; tag_id: number }>
  } else if (Number.isInteger(scope.weekNumber)) {
    assignmentRows = await sql`
      SELECT smt.material_id, smt.tag_id
      FROM subject_day_material_tags smt
      INNER JOIN subject_day_materials m ON m.id = smt.material_id
      WHERE m.subject_id = ${scope.subjectId}
        AND m.week_number = ${scope.weekNumber!}
      ORDER BY smt.material_id, smt.tag_id
    ` as Array<{ material_id: number; tag_id: number }>
  } else {
    assignmentRows = await sql`
      SELECT smt.material_id, smt.tag_id
      FROM subject_day_material_tags smt
      INNER JOIN subject_day_materials m ON m.id = smt.material_id
      WHERE m.subject_id = ${scope.subjectId}
      ORDER BY smt.material_id, smt.tag_id
    ` as Array<{ material_id: number; tag_id: number }>
  }

  const assignments: Record<string, number[]> = {}
  for (const row of assignmentRows) {
    const key = String(Number(row.material_id))
    assignments[key] ??= []
    assignments[key].push(Number(row.tag_id))
  }

  return {
    tags: tagRows.map(mapTag),
    assignments,
  }
}

export async function listTagsForMaterial(materialId: number) {
  const sql = getDatabase()
  const rows = await sql`
    SELECT
      t.id,
      t.name,
      t.normalized_name,
      t.color,
      t.parent_id,
      counts.usage_count,
      t.created_at,
      t.updated_at
    FROM subject_day_material_tags smt
    INNER JOIN tags t ON t.id = smt.tag_id
    LEFT JOIN (
      SELECT tag_id, COUNT(*)::int AS usage_count
      FROM subject_day_material_tags
      GROUP BY tag_id
    ) counts ON counts.tag_id = t.id
    WHERE smt.material_id = ${materialId}
    ORDER BY t.name ASC, t.id ASC
  ` as TagRow[]
  return rows.map(mapTag)
}

export async function listTagsForMaterials(materialIds: number[]) {
  const normalizedIds = Array.from(new Set(materialIds.filter(Number.isInteger)))
  const result: Record<string, StudyTag[]> = Object.fromEntries(
    normalizedIds.map((materialId) => [String(materialId), []])
  )
  if (normalizedIds.length === 0) return result

  const sql = getDatabase()
  const rows = await sql`
    SELECT
      smt.material_id,
      t.id,
      t.name,
      t.normalized_name,
      t.color,
      t.parent_id,
      counts.usage_count,
      t.created_at,
      t.updated_at
    FROM subject_day_material_tags smt
    INNER JOIN tags t ON t.id = smt.tag_id
    LEFT JOIN (
      SELECT tag_id, COUNT(*)::int AS usage_count
      FROM subject_day_material_tags
      GROUP BY tag_id
    ) counts ON counts.tag_id = t.id
    WHERE smt.material_id = ANY(${normalizedIds})
    ORDER BY smt.material_id, t.name, t.id
  ` as Array<TagRow & { material_id: number }>

  for (const row of rows) {
    result[String(Number(row.material_id))] ??= []
    result[String(Number(row.material_id))].push(mapTag(row))
  }
  return result
}

export async function createMaterialTag(input: {
  name: string
  color?: string
  parentId?: number | null
}) {
  const sql = getDatabase()
  const name = normalizeTagDisplayName(input.name)
  const normalizedName = normalizeTagName(input.name)
  if (!name || !normalizedName) throw new Error("TAG_NAME_REQUIRED")

  const parentId = Number.isInteger(input.parentId) ? Number(input.parentId) : null
  await assertParentIsValid(null, parentId)

  const inserted = await sql`
    INSERT INTO tags (name, normalized_name, color, parent_id)
    VALUES (${name}, ${normalizedName}, ${normalizeTagColor(input.color || "")}, ${parentId})
    ON CONFLICT (normalized_name) DO NOTHING
    RETURNING id
  ` as Array<{ id: number }>

  if (inserted[0]) {
    return { tag: (await getTagRow(Number(inserted[0].id)))!, created: true }
  }

  const existing = await sql`
    SELECT id FROM tags WHERE normalized_name = ${normalizedName} LIMIT 1
  ` as Array<{ id: number }>
  return { tag: (await getTagRow(Number(existing[0].id)))!, created: false }
}

export async function updateMaterialTag(
  tagId: number,
  input: { name?: string; color?: string; parentId?: number | null }
) {
  const current = await getTagRow(tagId)
  if (!current) return null

  const name = input.name === undefined ? current.name : normalizeTagDisplayName(input.name)
  const normalizedName = input.name === undefined ? current.normalizedName : normalizeTagName(input.name)
  if (!name || !normalizedName) throw new Error("TAG_NAME_REQUIRED")
  const color = input.color === undefined ? current.color : normalizeTagColor(input.color)
  const parentId = input.parentId === undefined
    ? current.parentId
    : Number.isInteger(input.parentId)
      ? Number(input.parentId)
      : null
  await assertParentIsValid(tagId, parentId)

  const sql = getDatabase()
  try {
    await sql`
      UPDATE tags
      SET name = ${name},
          normalized_name = ${normalizedName},
          color = ${color},
          parent_id = ${parentId},
          updated_at = NOW()
      WHERE id = ${tagId}
    `
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      throw new Error("TAG_NAME_CONFLICT")
    }
    throw error
  }
  return getTagRow(tagId)
}

export async function mergeMaterialTags(sourceTagId: number, targetTagId: number) {
  if (sourceTagId === targetTagId) throw new Error("TAG_MERGE_SAME")
  const source = await getTagRow(sourceTagId)
  const target = await getTagRow(targetTagId)
  if (!source || !target) return null
  await assertParentIsValid(sourceTagId, targetTagId)

  const sql = getDatabase()
  await sql`
    WITH moved AS (
      INSERT INTO subject_day_material_tags (material_id, tag_id)
      SELECT material_id, ${targetTagId}
      FROM subject_day_material_tags
      WHERE tag_id = ${sourceTagId}
      ON CONFLICT (material_id, tag_id) DO NOTHING
    ),
    detached AS (
      DELETE FROM subject_day_material_tags WHERE tag_id = ${sourceTagId}
    ),
    reparented AS (
      UPDATE tags
      SET parent_id = ${targetTagId}, updated_at = NOW()
      WHERE parent_id = ${sourceTagId} AND id <> ${targetTagId}
    )
    DELETE FROM tags WHERE id = ${sourceTagId}
  `
  return getTagRow(targetTagId)
}

export async function deleteMaterialTag(tagId: number, force: boolean) {
  const tag = await getTagRow(tagId)
  if (!tag) return { deleted: false, missing: true, usageCount: 0 }
  if (tag.usageCount > 0 && !force) {
    return { deleted: false, missing: false, usageCount: tag.usageCount }
  }
  const sql = getDatabase()
  await sql`DELETE FROM tags WHERE id = ${tagId}`
  return { deleted: true, missing: false, usageCount: tag.usageCount }
}

export async function assignTagToMaterial(materialId: number, tagId: number) {
  const sql = getDatabase()
  const rows = await sql`
    INSERT INTO subject_day_material_tags (material_id, tag_id)
    VALUES (${materialId}, ${tagId})
    ON CONFLICT (material_id, tag_id) DO NOTHING
    RETURNING material_id
  `
  if (!rows[0]) {
    const existing = await sql`
      SELECT material_id
      FROM subject_day_material_tags
      WHERE material_id = ${materialId} AND tag_id = ${tagId}
      LIMIT 1
    `
    if (!existing[0]) throw new Error("TAG_OR_MATERIAL_NOT_FOUND")
  }
  return listTagsForMaterial(materialId)
}

export async function unassignTagFromMaterial(materialId: number, tagId: number) {
  const sql = getDatabase()
  await sql`
    DELETE FROM subject_day_material_tags
    WHERE material_id = ${materialId} AND tag_id = ${tagId}
  `
  return listTagsForMaterial(materialId)
}

export async function getMaterialSubjectId(materialId: number) {
  const sql = getDatabase()
  const rows = await sql`
    SELECT subject_id FROM subject_day_materials WHERE id = ${materialId} LIMIT 1
  ` as Array<{ subject_id: string }>
  return rows[0]?.subject_id ?? null
}
