import { SubjectWheelLoader } from "@/components/subject-wheel-loader"
import { getRequestAuthSession } from "@/lib/authz"

type HomePageProps = {
  searchParams: Promise<{
    view?: string
    synthesisMode?: string
    synthesisWeek?: string
    synthesisSubject?: string
    returnToken?: string
  }>
}

export default async function Home({ searchParams }: HomePageProps) {
  const session = await getRequestAuthSession()
  if (!session) {
    return null
  }

  return <SubjectWheelLoader authSession={session} initialSearchParams={await searchParams} />
}
