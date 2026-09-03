import type { Metadata } from "next"
import { getRequestAuthSession } from "@/lib/authz"
import { SynthesisClient } from "./synthesis-client"

export const metadata: Metadata = { title: "Síntesis · Cursado 2026" }

export default async function SynthesisPage() {
  const session = await getRequestAuthSession()
  if (!session) return null
  return <SynthesisClient />
}
