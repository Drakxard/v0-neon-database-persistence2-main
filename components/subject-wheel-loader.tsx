"use client"

import dynamic from "next/dynamic"

import type { AuthSession } from "@/lib/authz"

type SubjectWheelSearchParams = {
  view?: string
  synthesisMode?: string
  synthesisWeek?: string
  synthesisSubject?: string
  returnToken?: string
}

const DynamicSubjectWheel = dynamic(
  () => import("@/components/subject-wheel").then((module) => module.SubjectWheel),
  {
    ssr: false,
  }
)

export function SubjectWheelLoader({
  authSession,
  initialSearchParams,
}: {
  authSession: AuthSession
  initialSearchParams?: SubjectWheelSearchParams
}) {
  return <DynamicSubjectWheel authSession={authSession} initialSearchParams={initialSearchParams} />
}
