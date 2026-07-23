import type { NeonQueryFunction } from "@neondatabase/serverless"

export function requireSql<ArrayMode extends boolean, FullResults extends boolean>(
  database: NeonQueryFunction<ArrayMode, FullResults> | null
): NeonQueryFunction<ArrayMode, FullResults> {
  if (!database) {
    throw new Error("DATABASE_URL is not configured.")
  }
  return database
}
