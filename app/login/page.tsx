import Link from "next/link"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const resolvedSearchParams = await searchParams
  const nextParam = typeof resolvedSearchParams.next === "string" ? resolvedSearchParams.next : "/"
  const errorParam = typeof resolvedSearchParams.error === "string" ? resolvedSearchParams.error : ""

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-6">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        {errorParam ? (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-center text-sm text-red-700">
            {errorParam}
          </div>
        ) : null}

        <Link
          href={`/api/auth/google/start?next=${encodeURIComponent(nextParam)}`}
          className="flex h-12 w-full items-center justify-center rounded-2xl bg-slate-950 text-sm font-medium text-white transition hover:bg-slate-800"
        >
          Continuar con Google
        </Link>
      </div>
    </main>
  )
}
