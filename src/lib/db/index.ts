import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Server-only database client.
 *
 * This module must never be imported from a client component. All data access
 * goes through server routes and server components — the browser never holds a
 * database client, so a mistaken RLS policy cannot leak data on its own.
 * See SPEC.md §12.
 */
import "server-only";

// Next dev reloads modules on every edit; without caching we exhaust the
// connection pool within a few saves.
const globalForDb = globalThis as unknown as {
  __seatBookingSql?: ReturnType<typeof postgres>;
  __seatBookingDb?: ReturnType<typeof createDb>;
};

function createDb() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local.");
  }

  const sql =
    globalForDb.__seatBookingSql ??
    postgres(connectionString, {
      max: 10,
      prepare: false, // Supabase transaction pooling has no prepared statements
    });

  if (process.env.NODE_ENV !== "production") {
    globalForDb.__seatBookingSql = sql;
  }

  return drizzle(sql, { schema, casing: "snake_case" });
}

// Connects on first query rather than at import time, so `next build` succeeds
// on a machine without secrets and fails at the request that actually needs one.
export const db = new Proxy({} as ReturnType<typeof createDb>, {
  get(_target, prop, receiver) {
    globalForDb.__seatBookingDb ??= createDb();
    return Reflect.get(globalForDb.__seatBookingDb, prop, receiver);
  },
});

export { schema };
