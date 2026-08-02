import Link from "next/link";

/**
 * Travellers never land here — they arrive on /t/<token> from a WhatsApp link.
 * This exists so the bare domain isn't a 404 for a curious coordinator.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5">
      <h1 className="text-2xl font-bold">Seat booking</h1>
      <p className="mt-2 text-slate-600 dark:text-slate-400">
        Weekly cab seats for the group.
      </p>
      <p className="mt-6 text-sm text-slate-500">
        Travellers: open the link shared in the WhatsApp group.
      </p>
      <Link
        href="/admin"
        className="mt-4 inline-block rounded-lg bg-slate-900 px-4 py-3 text-center font-semibold text-white dark:bg-slate-100 dark:text-slate-900"
      >
        Coordinator sign-in
      </Link>
    </main>
  );
}
