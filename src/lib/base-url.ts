import "server-only";
import { headers } from "next/headers";

/**
 * The origin this request arrived on, e.g. https://seat-booking-app-pi.vercel.app.
 *
 * Read from the request rather than an environment variable so the link a
 * coordinator copies is always the address they are actually looking at. A
 * configured base URL goes stale the moment the app is opened from a phone on
 * the LAN, or from a preview deployment, and a link that silently points at the
 * wrong host is worse than no button at all.
 */
export async function getBaseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  // Vercel always terminates TLS, so the forwarded proto is authoritative there;
  // locally there is none and http is right.
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
