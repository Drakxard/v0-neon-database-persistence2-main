import { getLegacyDatabase, requireSql } from "@/lib/db"
import { ensureSubjectAccess, requireAuthSession } from "@/lib/authz"
import { readLocalState, updateLocalState } from "@/lib/local-state-store"
import { getDefaultSubjectShortcuts, normalizeSubjectShortcutButton } from "@/lib/subject-shortcuts"
import { parseRequiredString } from "@/lib/server/request-parsing"
import { isLocalStorageMode } from "@/lib/storage-mode"
import type { SubjectShortcutButton, SubjectShortcuts } from "@/lib/study-types"
import { NextResponse } from "next/server"

export const runtime = "nodejs"

const sql = getLegacyDatabase()

type ShortcutRow = { id: number; label: string; url: string | null; order_index: number; section_scoped: boolean; section_urls: Record<string, string> | null; integration_role: "notebooklm" | null; active_section_key: string | null }

function badRequest(message: string) { return NextResponse.json({ error: message }, { status: 400 }) }
function isMissingTable(error: unknown) { return Boolean(error && typeof error === "object" && "code" in error && error.code === "42P01") }
function toResponse(subjectId: string, rows: ShortcutRow[]): SubjectShortcuts {
  return { subjectId, buttons: rows.map((row) => normalizeSubjectShortcutButton({ id: String(row.id), label: row.label, url: row.url, orderIndex: row.order_index, sectionScoped: row.section_scoped, sectionUrls: row.section_urls ?? {}, integrationRole: row.integration_role, activeSectionKey: row.active_section_key })) }
}
function localFallback(subjectId: string) { return getDefaultSubjectShortcuts(subjectId) }

async function selectButtons(subjectId: string) {
  return await requireSql(sql)`SELECT id, label, url, order_index, section_scoped, section_urls, integration_role, active_section_key FROM subject_shortcut_buttons WHERE subject_id = ${subjectId} ORDER BY order_index, id` as ShortcutRow[]
}
async function ensureRemoteButtons(subjectId: string) {
  const initialized = await requireSql(sql)`INSERT INTO subject_shortcut_button_sets (subject_id) VALUES (${subjectId}) ON CONFLICT (subject_id) DO NOTHING RETURNING subject_id`
  if (initialized.length > 0) {
    const defaults = getDefaultSubjectShortcuts(subjectId).buttons
    for (const button of defaults) {
      await requireSql(sql)`INSERT INTO subject_shortcut_buttons (subject_id, label, url, order_index, integration_role) VALUES (${subjectId}, ${button.label}, NULL, ${button.orderIndex}, ${button.integrationRole})`
    }
  }
  return toResponse(subjectId, await selectButtons(subjectId))
}
function normalizeLocalShortcut(subjectId: string, value: unknown): SubjectShortcuts {
  if (value && typeof value === "object" && Array.isArray((value as SubjectShortcuts).buttons)) return { ...(value as SubjectShortcuts), buttons: (value as SubjectShortcuts).buttons.map(normalizeSubjectShortcutButton) }
  const legacy = value as { eFich?: string | null; figma?: string | null; nlm?: string | null } | undefined
  const next = localFallback(subjectId)
  next.buttons = next.buttons.map((button, index) => ({ ...button, url: index === 0 ? legacy?.eFich ?? null : index === 1 ? legacy?.figma ?? null : legacy?.nlm ?? null }))
  return next
}

export async function GET(request: Request) {
  const subjectId = parseRequiredString(new URL(request.url).searchParams.get("subjectId"))
  try {
    const auth = await requireAuthSession(); if (auth.response) return auth.response
    if (!subjectId) return badRequest("Missing subjectId")
    const forbidden = ensureSubjectAccess(auth.session!, subjectId); if (forbidden) return forbidden
    if (isLocalStorageMode()) {
      const state = await readLocalState()
      return NextResponse.json(normalizeLocalShortcut(subjectId, state.subjectShortcuts[subjectId]))
    }
    return NextResponse.json(await ensureRemoteButtons(subjectId))
  } catch (error) {
    console.error("GET /api/subject-shortcuts error:", error)
    if (isMissingTable(error)) return NextResponse.json(localFallback(subjectId))
    return NextResponse.json({ error: "Failed to fetch subject shortcuts" }, { status: 500 })
  }
}

export async function POST(request: Request) {
  return mutate(request, async (subjectId, body) => {
    const label = parseRequiredString(body?.label); if (!label) return badRequest("Missing label")
    if (isLocalStorageMode()) return updateLocalState((state) => {
      const current = normalizeLocalShortcut(subjectId, state.subjectShortcuts[subjectId])
      state.subjectShortcuts[subjectId] = { ...current, buttons: [...current.buttons, { id: crypto.randomUUID(), label, url: null, orderIndex: current.buttons.length, sectionScoped: false, sectionUrls: {}, integrationRole: null, activeSectionKey: null }] }
      return state.subjectShortcuts[subjectId]
    })
    await ensureRemoteButtons(subjectId)
    const rows = await selectButtons(subjectId)
    await requireSql(sql)`INSERT INTO subject_shortcut_buttons (subject_id, label, url, order_index) VALUES (${subjectId}, ${label}, NULL, ${rows.length})`
    return ensureRemoteButtons(subjectId)
  })
}

export async function PUT(request: Request) {
  return mutate(request, async (subjectId, body) => {
    const id = parseRequiredString(body?.id); const url = parseRequiredString(body?.url)
    const sectionScoped = body?.sectionScoped === true
    const sectionKey = parseRequiredString(body?.sectionKey)
    if (!id) return badRequest("Missing id"); if (!url) return badRequest("Missing url")
    if (sectionScoped && !sectionKey) return badRequest("Missing sectionKey")
    let normalizedUrl: string; try { normalizedUrl = new URL(url).toString() } catch { return badRequest("Invalid url") }
    if (isLocalStorageMode()) return updateLocalState((state) => {
      const current = normalizeLocalShortcut(subjectId, state.subjectShortcuts[subjectId])
      state.subjectShortcuts[subjectId] = { ...current, buttons: current.buttons.map((button) => {
        if (button.id !== id) return button
        if (!sectionScoped) return { ...button, url: normalizedUrl, sectionScoped: false, sectionUrls: {}, activeSectionKey: null }
        return { ...button, sectionScoped: true, sectionUrls: { ...(button.sectionScoped ? button.sectionUrls : {}), [sectionKey!]: normalizedUrl }, activeSectionKey: sectionKey! }
      }) }
      return state.subjectShortcuts[subjectId]
    })
    await ensureRemoteButtons(subjectId)
    const current = (await selectButtons(subjectId)).find((button) => String(button.id) === id)
    if (!current) return badRequest("Unknown shortcut")
    const sectionUrls = sectionScoped
      ? { ...(current.section_scoped ? current.section_urls ?? {} : {}), [sectionKey!]: normalizedUrl }
      : {}
    await requireSql(sql)`UPDATE subject_shortcut_buttons SET url = ${sectionScoped ? current.url : normalizedUrl}, section_scoped = ${sectionScoped}, section_urls = ${JSON.stringify(sectionUrls)}::jsonb, active_section_key = ${sectionScoped ? sectionKey : null}, updated_at = NOW() WHERE subject_id = ${subjectId} AND id = ${Number(id)}`
    return ensureRemoteButtons(subjectId)
  })
}

export async function DELETE(request: Request) {
  return mutate(request, async (subjectId, body) => {
    const id = parseRequiredString(body?.id); if (!id) return badRequest("Missing id")
    if (isLocalStorageMode()) return updateLocalState((state) => {
      const current = normalizeLocalShortcut(subjectId, state.subjectShortcuts[subjectId])
      state.subjectShortcuts[subjectId] = { ...current, buttons: current.buttons.filter((button) => button.id !== id).map((button, orderIndex) => ({ ...button, orderIndex })) }
      return state.subjectShortcuts[subjectId]
    })
    await requireSql(sql)`DELETE FROM subject_shortcut_buttons WHERE subject_id = ${subjectId} AND id = ${Number(id)}`
    return ensureRemoteButtons(subjectId)
  })
}

async function mutate(request: Request, action: (subjectId: string, body: any) => Promise<SubjectShortcuts | NextResponse>) {
  try {
    const auth = await requireAuthSession(); if (auth.response) return auth.response
    const body = await request.json(); const subjectId = parseRequiredString(body?.subjectId)
    if (!subjectId) return badRequest("Missing subjectId")
    const forbidden = ensureSubjectAccess(auth.session!, subjectId); if (forbidden) return forbidden
    const result = await action(subjectId, body)
    return result instanceof NextResponse ? result : NextResponse.json(result)
  } catch (error) {
    console.error("/api/subject-shortcuts mutation error:", error)
    if (isMissingTable(error)) return NextResponse.json({ error: "Falta ejecutar la migración de accesos directos." }, { status: 503 })
    return NextResponse.json({ error: "Failed to save subject shortcut" }, { status: 500 })
  }
}
