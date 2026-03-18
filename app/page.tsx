import { SubjectWheel } from "@/components/subject-wheel"
import { getRequestAuthSession } from "@/lib/authz"

export default async function Home() {
  const session = await getRequestAuthSession()
  if (!session) {
    return null
  }

  return <SubjectWheel authSession={session} />
}
