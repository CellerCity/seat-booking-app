import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

/**
 * Prints a working sign-in link for a coordinator, bypassing email entirely.
 *
 * Supabase's built-in SMTP allows only a few messages an hour, which is fine in
 * real use — coordinators sign in rarely and stay signed in for a long time —
 * but makes testing on a second device impossible. This mints the same link the
 * email would have contained, using the admin API.
 *
 * Local development only. It needs the service role key, so it must never run
 * anywhere the output could be seen by someone who is not already a coordinator:
 * the printed link IS a sign-in, for anyone holding it, until it is used.
 *
 *   npm run dev:login -- you@example.com
 *   npm run dev:login -- you@example.com http://10.147.213.150:3000
 */

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  const origin = process.argv[3]?.trim().replace(/\/$/, "") ?? "http://localhost:3000";

  if (!email) {
    console.error("Usage: npm run dev:login -- <email> [origin]");
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
    process.exit(1);
  }

  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${origin}/admin/auth/callback` },
  });

  if (error) {
    console.error("Could not generate a link:", error.message);
    process.exit(1);
  }

  console.log(`\nSign-in link for ${email}  (single use, expires in ~1 hour)\n`);
  console.log(data.properties.action_link);
  console.log(
    `\nOpen it in the browser you want signed in. The redirect origin (${origin})` +
      `\nmust be listed in Supabase -> Authentication -> URL Configuration -> Redirect URLs.\n`,
  );
}

main();
