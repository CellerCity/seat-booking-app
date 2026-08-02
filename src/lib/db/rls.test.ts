import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@/test/db";

/**
 * Every table must have row-level security enabled.
 *
 * Supabase publishes everything in `public` through PostgREST, reachable with
 * the publishable key — which ships in the browser bundle by design. Tables
 * created by migrations arrive with RLS OFF, so for a while `GET /rest/v1/users`
 * returned the entire roster, phone numbers included, to anyone who viewed
 * source.
 *
 * This runs against the real migrations in PGlite, so a table added later
 * without protection fails here rather than in production. If you are reading
 * this because the test just went red: add the table to the RLS migration, do
 * not add it to the exception list. There is no exception list.
 */

let client: Awaited<ReturnType<typeof createTestDb>>["client"];

beforeEach(async () => {
  ({ client } = await createTestDb());
});

describe("row-level security", () => {
  it("is enabled on every table in the public schema", async () => {
    const result = await client.query<{ tablename: string; rls: boolean }>(`
      select c.relname as tablename, c.relrowsecurity as rls
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by c.relname
    `);

    const unprotected = result.rows.filter((t) => !t.rls).map((t) => t.tablename);

    expect(unprotected, `tables without RLS: ${unprotected.join(", ")}`).toEqual([]);
    // Sanity: the query found the tables at all, so an empty result cannot pass.
    expect(result.rows.length).toBeGreaterThanOrEqual(11);
  });

  it("has no policies, because nothing should reach the database from a browser", async () => {
    const result = await client.query<{ n: number }>(
      `select count(*)::int as n from pg_policies where schemaname = 'public'`,
    );

    // A policy here means someone opened a browser-side path to the data. That
    // may be legitimate, but it is a deliberate decision that should not slip in
    // unnoticed — all access goes through server routes today. See SPEC §12.
    expect(result.rows[0].n).toBe(0);
  });
});
