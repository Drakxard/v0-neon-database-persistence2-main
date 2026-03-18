import { NextResponse } from "next/server"

import { deleteAllowedAccountById, requireAdminSession } from "@/lib/authz"

export const runtime = "nodejs"

type RouteContext = {
  params: Promise<{
    id: string
  }>
}

export async function DELETE(_request: Request, context: RouteContext) {
  const auth = await requireAdminSession()
  if (auth.response) return auth.response

  const { id } = await context.params
  const accountId = Number.parseInt(id, 10)
  if (!Number.isInteger(accountId)) {
    return NextResponse.json({ error: "Invalid account id" }, { status: 400 })
  }

  const deleted = await deleteAllowedAccountById(accountId)
  if (!deleted) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 })
  }

  return NextResponse.json({ success: true, id: deleted.id })
}
