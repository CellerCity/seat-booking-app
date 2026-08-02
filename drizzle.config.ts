import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config({ path: ".env.local" });

// Migrations run over the direct connection: the pooled port does not support
// the session-level statements DDL needs.
// `generate` only reads the schema file, so it must work without a database.
// Commands that actually connect (migrate/push/studio) fail loudly on the
// placeholder, which is the right time to notice a missing .env.local.
const url =
  process.env.DIRECT_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://unset:unset@localhost:5432/unset";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./src/lib/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url },
  casing: "snake_case",
  verbose: true,
  strict: true,
});
