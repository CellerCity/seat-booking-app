import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "../src/lib/db/schema";
import { normalizePhone, PhoneError } from "../src/lib/phone";

config({ path: ".env.local" });

/**
 * Loads the roster and the cab types.
 *
 * Roster members are created `approved` — they are already known people, so
 * they are never asked to wait for a coordinator. Only strangers who arrive
 * through the WhatsApp link land in the approval queue.
 *
 * Expects data/roster.csv:  name,phone,role,member_type,affiliation,email
 * (only name and phone are required). That file is gitignored — it holds ~50
 * real phone numbers and must never be committed.
 */

const CSV_PATH = resolve(process.cwd(), "data/roster.csv");

type Row = {
  name: string;
  phone: string;
  role?: string;
  memberType?: string;
  affiliation?: string;
  email?: string;
};

function parseCsv(text: string): Row[] {
  // Spreadsheets pad exports with rows of bare separators (",,,,,"). Those are
  // blank lines, not malformed people, so they are dropped here rather than
  // reported as skipped rows — otherwise a 50-person export buries the warnings
  // that actually matter under empty ones.
  const isBlank = (l: string) => l.replace(/,/g, "").trim().length === 0;
  const lines = text.split(/\r?\n/).filter((l) => !isBlank(l));
  if (lines.length === 0) return [];

  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);

  const iName = idx("name");
  const iPhone = idx("phone");
  if (iName === -1 || iPhone === -1) {
    throw new Error("roster.csv needs at least 'name' and 'phone' columns");
  }

  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((c) => c.trim());
    return {
      name: cells[iName],
      phone: cells[iPhone],
      role: idx("role") > -1 ? cells[idx("role")] : undefined,
      memberType: idx("member_type") > -1 ? cells[idx("member_type")] : undefined,
      affiliation: idx("affiliation") > -1 ? cells[idx("affiliation")] : undefined,
      email: idx("email") > -1 ? cells[idx("email")] : undefined,
    };
  });
}

async function main() {
  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL in .env.local");

  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql, { schema, casing: "snake_case" });

  // --- Cab types ------------------------------------------------------------
  const existingTypes = await db.select().from(schema.cabTypes);
  if (existingTypes.length === 0) {
    await db.insert(schema.cabTypes).values([
      { name: "Tempo Traveller", capacity: 12 },
      { name: "Sedan", capacity: 4 },
    ]);
    console.log("Added 2 cab types (edit capacities and names to match your contractor)");
  } else {
    console.log(`${existingTypes.length} cab types already present, leaving them alone`);
  }

  // --- Roster ---------------------------------------------------------------
  if (!existsSync(CSV_PATH)) {
    console.log(`\nNo data/roster.csv found — skipping roster.`);
    console.log(`Copy data/roster.example.csv to data/roster.csv and fill it in.`);
    await sql.end();
    return;
  }

  const rows = parseCsv(readFileSync(CSV_PATH, "utf8"));
  let added = 0;
  let skipped = 0;
  const problems: string[] = [];

  for (const row of rows) {
    if (!row.name || !row.phone) {
      problems.push(`Missing name or phone: ${JSON.stringify(row)}`);
      continue;
    }

    let phone: string;
    try {
      phone = normalizePhone(row.phone);
    } catch (e) {
      problems.push(`${row.name}: ${e instanceof PhoneError ? e.message : "bad phone"}`);
      continue;
    }

    const [existing] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.phone, phone))
      .limit(1);

    if (existing) {
      skipped++;
      continue;
    }

    await db.insert(schema.users).values({
      name: row.name,
      phone,
      email: row.email?.toLowerCase() || null,
      role: row.role === "coordinator" ? "coordinator" : "traveller",
      memberType: row.memberType === "guest" ? "guest" : "regular",
      affiliation: row.affiliation || null,
      // Known people. The approval queue is only for strangers from the link.
      approvalStatus: "approved",
    });
    added++;
  }

  console.log(`\nRoster: ${added} added, ${skipped} already present`);

  if (problems.length > 0) {
    console.log(`\n${problems.length} row(s) skipped:`);
    for (const p of problems) console.log(`  - ${p}`);
  }

  const coordinators = await db
    .select({ name: schema.users.name, email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.role, "coordinator"));

  console.log(`\nCoordinators (${coordinators.length}):`);
  for (const c of coordinators) {
    console.log(`  - ${c.name} ${c.email ?? "⚠ NO EMAIL — cannot sign in"}`);
  }
  if (coordinators.some((c) => !c.email)) {
    console.log(
      "\n⚠ Coordinators sign in by email magic link, so every coordinator row needs an email.",
    );
  }

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
