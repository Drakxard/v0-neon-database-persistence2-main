export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const resolvedSearchParams = await searchParams
  const nextParam = typeof resolvedSearchParams.next === "string" ? resolvedSearchParams.next : "/"
  const errorParam = typeof resolvedSearchParams.error === "string" ? resolvedSearchParams.error : ""
  const emailParam = typeof resolvedSearchParams.email === "string" ? resolvedSearchParams.email : ""

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 px-6">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 space-y-2 text-center">
          <h1 className="text-2xl font-semibold text-slate-950">Ingresar</h1>
          <p className="text-sm text-slate-500">Escribe tu correo para entrar. El administrador y los accesos permitidos se validan en el servidor.</p>
        </div>

        {errorParam ? (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-center text-sm text-red-700">
            {errorParam}
          </div>
        ) : null}

        <form action="/api/auth/login" method="POST" className="space-y-4">
          <input type="hidden" name="next" value={nextParam} />
          <div className="space-y-2">
            <label htmlFor="email" className="block text-sm font-medium text-slate-700">
              Correo
            </label>
            <input
              id="email"
              name="email"
              type="email"
              defaultValue={emailParam}
              required
              autoComplete="email"
              placeholder="correo@gmail.com"
              className="h-12 w-full rounded-2xl border border-slate-300 px-4 text-sm text-slate-900 outline-none transition focus:border-slate-950"
            />
          </div>

          <button
            type="submit"
            className="flex h-12 w-full items-center justify-center rounded-2xl bg-slate-950 text-sm font-medium text-white transition hover:bg-slate-800"
          >
            Entrar
          </button>
        </form>
      </div>
    </main>
  )
}
