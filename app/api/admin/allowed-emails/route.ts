import { NextResponse } from "next/server"

import { createAllowedAccount, listAllowedAccounts, requireAdminSession } from "@/lib/authz"
import { normalizeAllowedSubjectIds } from "@/lib/subjects"

export const runtime = "nodejs"

export async function GET() {
  const auth = await requireAdminSession()
  if (auth.response) return auth.response

  const accounts = await listAllowedAccounts()
  return NextResponse.json(
    accounts.map((account) => ({
      id: account.id,
      email: account.email,
      allowedSubjectIds: account.allowed_subject_ids,
      createdAt: account.created_at,
      updatedAt: account.updated_at,
    }))
  )
}

export async function POST(request: Request) {
  const auth = await requireAdminSession()
  if (auth.response) return auth.response

  try {
    const body = await request.json()
    const email = String(body?.email || "").trim().toLowerCase()
    const allowedSubjectIds = normalizeAllowedSubjectIds(Array.isArray(body?.allowedSubjectIds) ? body.allowedSubjectIds : [])

    if (!email) {
      return NextResponse.json({ error: "Missing email" }, { status: 400 })
    }

    if (allowedSubjectIds.length === 0) {
      return NextResponse.json({ error: "Select at least one subject" }, { status: 400 })
    }

    const account = await createAllowedAccount(email, allowedSubjectIds)
    return NextResponse.json({
      id: account.id,
      email: account.email,
      allowedSubjectIds: account.allowed_subject_ids,
      createdAt: account.created_at,
      updatedAt: account.updated_at,
    })
  } catch (error) {
    console.error("POST /api/admin/allowed-emails error:", error)
    const message = error instanceof Error ? error.message : "Failed to create allowed account"
    const status = message.toLowerCase().includes("duplicate") || message.toLowerCase().includes("unique") ? 409 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
