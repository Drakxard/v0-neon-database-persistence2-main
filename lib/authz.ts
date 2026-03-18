import { cookies } from "next/headers"
import { neon } from "@neondatabase/serverless"
import { NextResponse } from "next/server"

import { APP_AUTH_COOKIE_NAME, getAppAuthConfig, verifySessionToken, type AppSessionTokenPayload } from "@/lib/app-auth"
import { SUBJECT_IDS, normalizeAllowedSubjectIds, getSubjectIdFromIndex } from "@/lib/subjects"

const sql = neon(process.env.DATABASE_URL!)

export type AllowedAccountRow = {
  id: number
  email: string
  allowed_subject_ids: string[] | string
  created_at: string
  updated_at: string
}

export type AuthSession = AppSessionTokenPayload

function normalizeAllowedSubjectIdsColumn(value: AllowedAccountRow["allowed_subject_ids"]) {
  const parsed = typeof value === "string" ? JSON.parse(value) : value
  return normalizeAllowedSubjectIds(Array.isArray(parsed) ? parsed : [])
}

export function getAdminEmail() {
  return getAppAuthConfig().adminEmail
}

export function getAdminSession() {
  return {
    isAdmin: true,
    allowedSubjectIds: SUBJECT_IDS,
  }
}

export async function getAllowedAccountByEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase()
  if (!normalizedEmail) return null

  const rows = await sql`
    SELECT id, email, allowed_subject_ids, created_at, updated_at
    FROM allowed_google_accounts
    WHERE email = ${normalizedEmail}
    LIMIT 1
  ` as AllowedAccountRow[]

  if (!rows[0]) return null

  return {
    ...rows[0],
    email: rows[0].email.toLowerCase(),
    allowed_subject_ids: normalizeAllowedSubjectIdsColumn(rows[0].allowed_subject_ids),
  }
}

export async function listAllowedAccounts() {
  const rows = await sql`
    SELECT id, email, allowed_subject_ids, created_at, updated_at
    FROM allowed_google_accounts
    ORDER BY email ASC
  ` as AllowedAccountRow[]

  return rows.map((row) => ({
    ...row,
    email: row.email.toLowerCase(),
    allowed_subject_ids: normalizeAllowedSubjectIdsColumn(row.allowed_subject_ids),
  }))
}

export async function createAllowedAccount(email: string, allowedSubjectIds: string[]) {
  const normalizedEmail = email.trim().toLowerCase()
  const normalizedSubjects = normalizeAllowedSubjectIds(allowedSubjectIds)

  const rows = await sql`
    INSERT INTO allowed_google_accounts (email, allowed_subject_ids)
    VALUES (${normalizedEmail}, ${JSON.stringify(normalizedSubjects)})
    RETURNING id, email, allowed_subject_ids, created_at, updated_at
  ` as AllowedAccountRow[]

  return {
    ...rows[0],
    email: rows[0].email.toLowerCase(),
    allowed_subject_ids: normalizeAllowedSubjectIdsColumn(rows[0].allowed_subject_ids),
  }
}

export async function deleteAllowedAccountById(id: number) {
  const rows = await sql`
    DELETE FROM allowed_google_accounts
    WHERE id = ${id}
    RETURNING id
  ` as Array<{ id: number }>

  return rows[0] ?? null
}

export async function getRequestAuthSession(): Promise<AuthSession | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(APP_AUTH_COOKIE_NAME)?.value
  if (!token) return null

  const { sessionSecret } = getAppAuthConfig()
  return verifySessionToken(token, sessionSecret)
}

export async function requireAuthSession() {
  const session = await getRequestAuthSession()
  if (!session) {
    return { session: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) }
  }

  return { session, response: null }
}

export async function requireAdminSession() {
  const auth = await requireAuthSession()
  if (auth.response) return auth
  if (!auth.session?.isAdmin) {
    return { session: auth.session, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) }
  }

  return auth
}

export function canAccessSubject(session: AuthSession, subjectId: string) {
  return session.isAdmin || session.allowedSubjectIds.includes(subjectId)
}

export function ensureSubjectAccess(session: AuthSession, subjectId: string) {
  return canAccessSubject(session, subjectId)
    ? null
    : NextResponse.json({ error: "Forbidden" }, { status: 403 })
}

export function ensureQuestionSubjectAccess(session: AuthSession, idMateria: number | null) {
  const subjectId = getSubjectIdFromIndex(idMateria)
  if (!subjectId) {
    return NextResponse.json({ error: "Invalid subject" }, { status: 400 })
  }

  return ensureSubjectAccess(session, subjectId)
}
