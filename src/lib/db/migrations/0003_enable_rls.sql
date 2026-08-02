-- Close the database to the browser.
--
-- Supabase publishes every table in `public` through PostgREST, reachable by
-- anyone holding the publishable key -- and that key ships in the browser
-- bundle by design. Tables created by these migrations arrive with row-level
-- security OFF (Supabase only enables it for tables made in its dashboard), so
-- until now `GET /rest/v1/users` returned the whole roster: names, phone
-- numbers and emails, to anyone who viewed source.
--
-- Enabling RLS with no policies denies every request arriving as `anon` or
-- `authenticated`. The app is unaffected: it connects over the direct Postgres
-- connection as the table owner, which RLS does not apply to. Nothing in the
-- app has ever queried Supabase from the browser -- see SPEC §12 -- so there is
-- no policy to write. If a browser-side query is ever added it will need an
-- explicit policy, which is exactly the conversation that should happen first.
--
-- The REVOKE is belt and braces: it removes the grants PostgREST relies on, so
-- a future table that someone forgets to protect is still not readable by an
-- anonymous caller.

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trips" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "responses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "response_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cab_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cabs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attendance" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dues" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "due_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "settlements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- `anon` and `authenticated` are Supabase's own roles. They do not exist in a
-- plain Postgres — including the PGlite instance the tests run against — so this
-- is guarded rather than assumed, and stays idempotent on re-run.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r
      );
    END IF;
  END LOOP;
END $$;
