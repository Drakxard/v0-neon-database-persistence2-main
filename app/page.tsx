import { SubjectWheel } from "@/components/subject-wheel"
import { getRequestAuthSession } from "@/lib/authz"
import { redirect } from "next/navigation"

type HomePageProps = {
  searchParams: Promise<{
    returnToken?: string
  }>
}

export default async function Home({ searchParams }: HomePageProps) {
  const session = await getRequestAuthSession()
  if (!session) {
    redirect("/login?next=/")
  }

  return <SubjectWheel authSession={session} initialSearchParams={await searchParams} />
}
