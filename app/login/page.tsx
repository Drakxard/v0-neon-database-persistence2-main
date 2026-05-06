import { redirect } from "next/navigation"

import { isLocalStorageMode } from "@/lib/storage-mode"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const resolvedSearchParams = await searchParams
  const nextParam = typeof resolvedSearchParams.next === "string" ? resolvedSearchParams.next : "/"
  const errorParam = typeof resolvedSearchParams.error === "string" ? resolvedSearchParams.error : ""
  const emailParam = typeof resolvedSearchParams.email === "string" ? resolvedSearchParams.email : ""

  if (isLocalStorageMode()) {
    redirect(nextParam)
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground transition-colors duration-300">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-8 shadow-sm">
        <div className="mb-6 space-y-2 text-center">
          <h1 className="text-2xl font-semibold text-foreground">Ingresar</h1>
          <p className="text-sm text-muted-foreground">Escribe tu correo para entrar. El administrador y los accesos permitidos se validan en el servidor.</p>
        </div>

        {errorParam ? (
          <div className="mb-6 rounded-xl border border-red-300/60 bg-red-500/10 px-4 py-3 text-center text-sm text-red-600">
            {errorParam}
          </div>
        ) : null}

        <form action="/api/auth/login" method="POST" className="space-y-4">
          <input type="hidden" name="next" value={nextParam} />
          <div className="space-y-2">
            <label htmlFor="email" className="block text-sm font-medium text-foreground">
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
              className="h-12 w-full rounded-2xl border border-input bg-background px-4 text-sm text-foreground outline-none transition focus:border-ring"
            />
          </div>

          <button
            type="submit"
            className="flex h-12 w-full items-center justify-center rounded-2xl bg-primary text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
          >
            Entrar
          </button>
        </form>
      </div>
    </main>
  )
}
