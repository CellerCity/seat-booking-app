import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/lib/db/schema";

/**
 * A real Postgres for tests, running in-process via WASM.
 *
 * This exercises the actual generated migrations — enums, constraints, unique
 * indexes and all — rather than a hand-rolled approximation, so a schema
 * mistake fails here instead of in production.
 */
export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema, casing: "snake_case" });

  const dir = resolve(process.cwd(), "src/lib/db/migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const sql = readFileSync(resolve(dir, file), "utf8");
    // Drizzle separates statements with this marker.
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) await client.exec(trimmed);
    }
  }

  return { db, client, schema };
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>["db"];
