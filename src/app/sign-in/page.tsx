import Link from "next/link";
import { KeyRound } from "lucide-react";

/**
 * Honest operator-access page. There is no multi-user account system in this
 * private beta — the workspace uses a shared operator credential.
 */
export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-2xl flex-col justify-center px-6 py-16">
      <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-slate-500">Access</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Operator sign-in</h1>
      <div className="mt-6 space-y-4 rounded-2xl border border-slate-200 bg-white p-6 text-sm leading-6 text-slate-600 shadow-sm">
        <p>
          PerfectProperty is a <strong className="text-slate-900">private beta with a shared operator credential</strong>.
          There is no public email/password account system in this build.
        </p>
        <p>
          Research workspace actions require the operator key configured on the server
          (<code className="rounded bg-slate-100 px-1">SCRAPER_ADMIN_TOKEN</code> /
          <code className="rounded bg-slate-100 px-1">PROPERTY_OPERATOR_SECRET</code>).
        </p>
        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-950">
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Public listing search does not require sign-in. Workspace unlock and write APIs do.
            Lost operator keys cannot be recovered from the client — rotate on the server and redistribute.
          </span>
        </p>
      </div>
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/listings" className="inline-flex h-12 items-center rounded-xl bg-[#0F172A] px-5 text-sm font-semibold text-white hover:bg-[#1E293B]">
          Continue to listings
        </Link>
        <Link href="/#live-feed" className="inline-flex h-12 items-center rounded-xl border border-slate-300 px-5 text-sm font-semibold text-slate-800 hover:bg-slate-50">
          Back to home
        </Link>
      </div>
    </main>
  );
}
