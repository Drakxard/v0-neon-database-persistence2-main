export type SqlQueryFunction = (
  query: TemplateStringsArray | string,
  ...values: unknown[]
) => Promise<any[]>

export type LegacyPoolClient = {
  query: (query: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount: number | null }>
  release: () => void
}

export type LegacyPool = {
  connect: () => Promise<LegacyPoolClient>
}

/**
 * The application is local-first. This compatibility value keeps old, unreachable
 * remote branches type-safe while making it impossible to open a SQL connection.
 */
export function getLegacyDatabase(): SqlQueryFunction | null {
  return null
}

export function getLegacyPool(): LegacyPool | null {
  return null
}

export function requireSql(database: SqlQueryFunction | null): SqlQueryFunction {
  if (!database) {
    throw new Error("La persistencia SQL remota está deshabilitada; usá el workspace local.")
  }
  return database
}
