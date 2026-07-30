import { neon } from "@neondatabase/serverless"

import { normalizeTagDisplayName, normalizeTagName } from "@/lib/tag-utils"
import type { SubjectMaterialContainer, SubjectMaterialContainerKind } from "@/lib/study-types"

const database = process.env.DATABASE_URL ? neon(process.env.DATABASE_URL) : null

type ContainerRow = {
  id: number | string
  subject_id: string
  name: string
  normalized_name: string
  kind: SubjectMaterialContainerKind
  order_index: number | string
  material_count: number | string
  created_at: string | Date
  updated_at: string | Date
}

function sqlClient() {
  if (!database) throw new Error("DATABASE_URL is not configured.")
  return database
}

function iso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : String(value)
}

function mapContainer(row: ContainerRow): SubjectMaterialContainer {
  return {
    id: Number(row.id),
    subjectId: row.subject_id,
    name: row.name,
    normalizedName: row.normalized_name,
    kind: row.kind,
    orderIndex: Number(row.order_index),
    materialCount: Number(row.material_count || 0),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  }
}

export async function ensureSubjectMaterialContainers(subjectId: string) {
  const sql = sqlClient()
  await sql`
    INSERT INTO subject_material_containers (subject_id, name, normalized_name, kind, order_index)
    VALUES
      (${subjectId}, 'Teoría', 'teoría', 'theory', 0),
      (${subjectId}, 'Práctica', 'práctica', 'practice', 1)
    ON CONFLICT (subject_id, normalized_name) DO NOTHING
  `
}

export async function listSubjectMaterialContainers(subjectId: string) {
  await ensureSubjectMaterialContainers(subjectId)
  const sql = sqlClient()
  const rows = await sql`
    SELECT c.id, c.subject_id, c.name, c.normalized_name, c.kind, c.order_index,
           COUNT(m.id)::int AS material_count, c.created_at, c.updated_at
    FROM subject_material_containers c
    LEFT JOIN subject_day_materials m ON m.container_id = c.id
    WHERE c.subject_id = ${subjectId}
    GROUP BY c.id
    ORDER BY c.order_index, c.id
  ` as ContainerRow[]
  return rows.map(mapContainer)
}

export async function getSubjectMaterialContainer(containerId: number) {
  const sql = sqlClient()
  const rows = await sql`
    SELECT c.id, c.subject_id, c.name, c.normalized_name, c.kind, c.order_index,
           COUNT(m.id)::int AS material_count, c.created_at, c.updated_at
    FROM subject_material_containers c
    LEFT JOIN subject_day_materials m ON m.container_id = c.id
    WHERE c.id = ${containerId}
    GROUP BY c.id
    LIMIT 1
  ` as ContainerRow[]
  return rows[0] ? mapContainer(rows[0]) : null
}

export async function getFixedSubjectMaterialContainer(subjectId: string, kind: "theory" | "practice") {
  await ensureSubjectMaterialContainers(subjectId)
  const containers = await listSubjectMaterialContainers(subjectId)
  return containers.find((container) => container.kind === kind)!
}

export async function createSubjectMaterialContainer(subjectId: string, rawName: string) {
  const name = normalizeTagDisplayName(rawName)
  const normalizedName = normalizeTagName(rawName)
  if (!name || !normalizedName) throw new Error("CONTAINER_NAME_REQUIRED")
  await ensureSubjectMaterialContainers(subjectId)
  const sql = sqlClient()
  const orderRows = await sql`
    SELECT COALESCE(MAX(order_index), 1)::int + 1 AS next_order
    FROM subject_material_containers
    WHERE subject_id = ${subjectId}
  ` as Array<{ next_order: number }>
  try {
    const rows = await sql`
      INSERT INTO subject_material_containers (
        subject_id, name, normalized_name, kind, order_index
      ) VALUES (
        ${subjectId}, ${name}, ${normalizedName}, 'custom', ${Number(orderRows[0]?.next_order ?? 2)}
      )
      RETURNING id
    ` as Array<{ id: number }>
    return getSubjectMaterialContainer(Number(rows[0].id))
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      throw new Error("CONTAINER_NAME_CONFLICT")
    }
    throw error
  }
}

export async function renameSubjectMaterialContainer(containerId: number, rawName: string) {
  const container = await getSubjectMaterialContainer(containerId)
  if (!container) return null
  if (container.kind !== "custom") throw new Error("CONTAINER_FIXED")
  const name = normalizeTagDisplayName(rawName)
  const normalizedName = normalizeTagName(rawName)
  if (!name || !normalizedName) throw new Error("CONTAINER_NAME_REQUIRED")
  const sql = sqlClient()
  try {
    await sql`
      UPDATE subject_material_containers
      SET name = ${name}, normalized_name = ${normalizedName}, updated_at = NOW()
      WHERE id = ${containerId}
    `
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      throw new Error("CONTAINER_NAME_CONFLICT")
    }
    throw error
  }
  return getSubjectMaterialContainer(containerId)
}

export async function deleteSubjectMaterialContainer(containerId: number) {
  const container = await getSubjectMaterialContainer(containerId)
  if (!container) return { deleted: false, missing: true, materialCount: 0 }
  if (container.kind !== "custom") throw new Error("CONTAINER_FIXED")
  if (container.materialCount > 0) {
    return { deleted: false, missing: false, materialCount: container.materialCount }
  }
  const sql = sqlClient()
  await sql`DELETE FROM subject_material_containers WHERE id = ${containerId}`
  return { deleted: true, missing: false, materialCount: 0 }
}
