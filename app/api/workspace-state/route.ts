import { NextResponse } from "next/server"

import { requireAuthSession } from "@/lib/authz"
import { readWorkspaceStateForUser, writeWorkspaceStateForUser } from "@/lib/workspace-state"

export const runtime = "nodejs"

export async function GET() {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const state = await readWorkspaceStateForUser(auth.session!.email)
    return NextResponse.json(state)
  } catch (error) {
    console.error("GET /api/workspace-state error:", error)
    return NextResponse.json({ error: "Failed to fetch workspace state" }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await requireAuthSession()
    if (auth.response) return auth.response

    const body = await request.json().catch(() => null)
    const state = await writeWorkspaceStateForUser(auth.session!.email, {
      workspaceTabs: body?.workspaceTabs,
      activeWorkspaceTabId: body?.activeWorkspaceTabId,
      customSubjects: body?.customSubjects,
      isMainWorkspaceTabVisible: body?.isMainWorkspaceTabVisible,
    })

    return NextResponse.json(state)
  } catch (error) {
    console.error("PUT /api/workspace-state error:", error)
    return NextResponse.json({ error: "Failed to save workspace state" }, { status: 500 })
  }
}
