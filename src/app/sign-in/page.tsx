import Link from "next/link";
import { KeyRound } from "lucide-react";
import { OperatorUnlockForm } from "@/components/workspace/operator-unlock-form";
import { MemberSignInForm } from "@/components/account/account-panel";

/**
 * Members sign in with an emailed one-time link. The operator section below
 * keeps the shared operator credential for research and collection tools.
 */
export default function SignInPage() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-2xl flex-col justify-center px-6 py-16">
      <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-ink-3">Access</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-ink">Sign in</h1>
      <div className="mt-6 rounded-2xl border border-line bg-card p-6 shadow-sm">
        <p className="mb-4 text-sm leading-6 text-ink-3">Subscribers sign in with their email. We send a one-time link; there is no password. New here? The same link creates your account.</p>
        <MemberSignInForm />
      </div>
      <h2 className="mt-12 text-2xl font-bold tracking-tight text-ink">Operator sign-in</h2>
      <div className="mt-4 space-y-4 rounded-2xl border border-line bg-card p-6 text-sm leading-6 text-ink-3 shadow-sm">
        <p>
          Research, sources, document review, and collection controls use a <strong className="text-ink">shared operator credential</strong>
          {" "}(<code className="rounded bg-line px-1">SCRAPER_ADMIN_TOKEN</code> /
          <code className="rounded bg-line px-1">PROPERTY_OPERATOR_SECRET</code>). A member subscription does not unlock them.
        </p>
        <p className="flex items-start gap-2 rounded-xl border border-line-strong bg-paper p-3 text-ink-2">
          <KeyRound className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Public listing search does not require sign-in.
            Lost operator keys cannot be recovered from the client — rotate on the server and redistribute.
          </span>
        </p>
      </div>
      <OperatorUnlockForm />
      <div className="mt-6 flex flex-wrap gap-3">
        <Link href="/listings" className="inline-flex h-12 items-center rounded-xl bg-ink px-5 text-sm font-semibold text-white hover:bg-ink-2">
          Continue to listings
        </Link>
        <Link href="/#live-feed" className="inline-flex h-12 items-center rounded-xl border border-line-strong px-5 text-sm font-semibold text-ink-2 hover:bg-paper">
          Back to home
        </Link>
      </div>
    </main>
  );
}
