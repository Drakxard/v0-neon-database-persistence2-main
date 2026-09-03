import type { Metadata } from "next"
import { getRequestAuthSession } from "@/lib/authz"
import { SynthesisClient } from "./synthesis-client"
import { cleanSynthesisName } from "@/lib/synthesis-tree"
import { parseSynthesisContext } from "@/lib/synthesis-context"

export const metadata: Metadata = { title: "Síntesis · Cursado 2026" }

export default async function SynthesisPage({
  searchParams,
}: {
  searchParams: Promise<{ subjectId?: string; weekNumber?: string; subjectName?: string; returnToken?: string }>
}) {
  const session = await getRequestAuthSession()
  if (!session) return null
  const params = await searchParams
  try {
    const context = parseSynthesisContext(params.subjectId, params.weekNumber)
    const subjectName = cleanSynthesisName(params.subjectName) || context.subjectId
    const returnToken = /^[A-Za-z0-9_-]{1,100}$/.test(params.returnToken ?? "") ? params.returnToken! : ""
    return <SynthesisClient context={context} subjectName={subjectName} returnToken={returnToken} />
  } catch (error) {
    return (
      <main style={{ minHeight: "100dvh", display: "grid", placeContent: "center", gap: 16, padding: 24, textAlign: "center" }}>
        <h1>No se pudo abrir esta Síntesis</h1>
        <p>{error instanceof Error ? error.message : "Falta la materia o la semana."}</p>
        <a href="/">Volver a las materias</a>
      </main>
    )
  }
}
