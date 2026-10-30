import type { Metadata } from "next";
import Link from "next/link";
import { Lock, Shield, EyeOff, Cookie, ArrowLeft } from "lucide-react";

export const metadata: Metadata = {
  title: "Privacy Policy | PerfectProperty",
  description:
    "Data minimization policies, zero third-party monetization, and privacy protections for the PerfectProperty platform.",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-4xl px-6 py-16 text-ink sm:px-8">
      <div className="mb-8">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm font-semibold text-ink-3 hover:text-ink transition-colors"
        >
          <ArrowLeft className="h-4 w-4" /> Back to home
        </Link>
      </div>

      <div className="border-b border-line pb-8">
        <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-ink-3">Privacy & Data Governance</p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-ink sm:text-4xl">
          Privacy Policy
        </h1>
        <p className="mt-3 text-sm text-ink-3">
          Last revised: October 22, 2026 · Committed to absolute data minimization
        </p>
      </div>

      <div className="mt-8 space-y-10 text-sm leading-7 text-ink-2">
        {/* Section 1 */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-ink flex items-center gap-2">
            <EyeOff className="h-5 w-5 text-ink-2" />
            1. Zero Sale of Personal Data
          </h2>
          <p>
            PerfectProperty maintains an uncompromising stance on personal privacy: <strong>we do not sell, rent, lease, or monetize your personal information, search queries, saved criteria, or usage habits to third-party data brokers, marketing networks, or advertisers.</strong>
          </p>
          <p>
            Our revenue model is based strictly on software subscriptions and professional triage tooling, not on advertising
            or monetizing user attention.
          </p>
        </section>

        {/* Section 2 */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-ink flex items-center gap-2">
            <Shield className="h-5 w-5 text-ink-2" />
            2. Public Record Aggregation & Distressed Property Transparency
          </h2>
          <p>
            The real estate information presented on our platform—including parcel numbers, legal descriptions,
            judgment amounts, court case numbers, plaintiff lenders, and defendant names—consists exclusively of
            <strong> statutorily mandated public legal notices</strong> published in newspapers of record, county clerk
            indexes, and governmental surplus inventories.
          </p>
          <p>
            We collect this information through lawful public notice subscriptions, RSS feeds, and official county electronic portals.
            We <strong>do not aggregate or display private phone numbers, social security numbers, credit scores, or
            personal consumer credit reports</strong>.
          </p>
        </section>

        {/* Section 3 */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-ink flex items-center gap-2">
            <Cookie className="h-5 w-5 text-ink-2" />
            3. Cookies, Local Storage & Security Architecture
          </h2>
          <p>
            We use strictly necessary functional storage mechanisms to support platform operation:
          </p>
          <ul className="list-disc pl-5 space-y-1.5 text-xs text-ink-3">
            <li>
              <code>pp_watchlist</code>: Browser cookie used to maintain your private saved property identifiers across sessions.
            </li>
            <li>
              <code>pp_compare_ids</code>: Local storage token tracking properties selected for pairwise financial comparison.
            </li>
            <li>
              <code>pp_operator_session</code>: Cryptographically secure HTTP-only session cookie verifying operator permissions.
            </li>
          </ul>
          <p className="mt-2">
            We do not deploy cross-site tracking pixels or invasive canvas fingerprinting scripts. Every page is secured by
            per-request dynamic Content Security Policy (CSP) nonces enforcing <code>strict-dynamic</code> execution.
          </p>
        </section>

        {/* Section 4 */}
        <section className="space-y-3">
          <h2 className="text-lg font-bold text-ink flex items-center gap-2">
            <Lock className="h-5 w-5 text-ink-2" />
            4. Voluntary Communications & Email Subscriptions
          </h2>
          <p>
            When you register for coverage alerts or submit an inquiry through our contact portal, your email address
            and message are stored in plain-text files on the server. You may unsubscribe at any time using our
            automated <Link href="/newsletter/unsubscribe" className="text-ink font-semibold underline">Unsubscribe portal</Link>,
            which removes your address from the stored subscriber list.
          </p>
          <p>
            A member account stores your email, the hunts, saved searches, and watchlist you create, and the
            subscription status Stripe reports. Stripe processes card payments; we never see or store card numbers.
            Sign-in uses a one-time emailed link kept only as a hash until it is used or expires. The{" "}
            <code>pp_member_session</code> cookie keeps you signed in for 30 days.
          </p>
        </section>

        {/* Section 5 */}
        <section className="space-y-3 border-t border-line pt-6">
          <h2 className="text-lg font-bold text-ink">
            5. California Consumer Privacy Act (CCPA / CPRA) & Data Rights
          </h2>
          <p>
            Under California privacy statutes, consumers maintain specific rights regarding personal information:
          </p>
          <ul className="list-disc pl-5 space-y-1 text-xs text-ink-3">
            <li><strong>Right to Know:</strong> You may request disclosure of any personal data we hold associated with your email.</li>
            <li><strong>Right to Delete:</strong> You may request deletion of your submitted contact or alert details through the <Link href="/contact" className="text-ink font-semibold underline">contact form</Link>; the operator deletes them by hand.</li>
            <li><strong>Right to Non-Discrimination:</strong> We never discriminate or alter service pricing based on the exercise of statutory privacy rights.</li>
          </ul>
        </section>
      </div>

      <div className="mt-12 rounded-2xl border border-line bg-paper p-6 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-ink">Privacy or Data Inquiries</h3>
          <p className="text-xs text-ink-3 mt-1">Submit a data subject access or deletion request.</p>
        </div>
        <Link
          href="/contact"
          className="rounded-lg bg-ink px-4 py-2.5 text-xs font-semibold text-white hover:bg-ink-2 transition"
        >
          Contact Privacy Team
        </Link>
      </div>
    </main>
  );
}
