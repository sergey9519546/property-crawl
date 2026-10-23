import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  ArrowLeft,
  Building2,
  FileText,
  ShieldCheck,
  BarChart3,
  type LucideIcon,
} from "lucide-react";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";

type InfoSection = {
  id?: string;
  title: string;
  body: string;
  link?: { label: string; href: string };
};

type InfoPage = {
  eyebrow: string;
  title: string;
  intro: string;
  sections: InfoSection[];
};

const PAGE_ICONS: Record<string, LucideIcon> = {
  enterprise: Building2,
  "case-studies": BarChart3,
  security: ShieldCheck,
};

const INFO_PAGES: Record<string, InfoPage> = {
  enterprise: {
    eyebrow: "Enterprise",
    title: "One shared operator workspace.",
    intro: "PerfectProperty has individual member accounts with a monthly subscription, plus one shared operator credential for research and collection tools. There is no per-seat team plan, role list, or enterprise contract.",
    sections: [
      { title: "What you can use", body: "The live listing feed, the source catalog, saved searches inside the operator workspace, and the contact form." },
      { title: "What this build does not include", body: "There is no role-based access, no separate customer tenancy, and no published enterprise plan." },
      { title: "Ask the operator", body: "Use the contact form. The server stores the message. Email leaves the server only when Resend is configured, or when a webhook is configured and Resend is not.", link: { label: "Open the contact form", href: "/contact" } },
    ],
  },
  "case-studies": {
    eyebrow: "Case studies",
    title: "No published customer studies.",
    intro: "This beta does not publish customer names, customer counts, or performance figures.",
    sections: [
      { id: "sourcing", title: "What you can check yourself", body: "Open a live listing and see whether the source URL resolves, and whether the score stays empty when no observed value band is on the record." },
      { id: "review", title: "What a listing review includes", body: "The decision path shows the published terms the collector stored, the title-rules check, and an assessor reading only for an enrolled county. It does not record a bid instruction." },
      { id: "outcomes", title: "What is not claimed", body: "This page does not report closed sales, reserve-met outcomes, testimonials, or a customer logo as a partnership." },
    ],
  },
  security: {
    eyebrow: "Trust",
    title: "Security and responsible use",
    intro: "The beta separates the public interface from the data API and validates untrusted notice text before it reaches downstream workflows.",
    sections: [
      { title: "Current controls", body: "The backend includes input validation, sanitization, rate limiting, bounded request bodies, AI prompt delimiters, and output validation tests. Scraper runs and workspace writes require the operator credential." },
      { title: "What is not in this beta", body: "There is no separate disclosure program." },
      { title: "Reporting", body: "Use the contact form. That is the security-reporting channel in this beta.", link: { label: "Open the contact form", href: "/contact" } },
    ],
  },
};

export function generateStaticParams() {
  return Object.keys(INFO_PAGES).map((slug) => ({ slug }));
}

export default async function InformationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = INFO_PAGES[slug];

  if (!page) notFound();

  const Icon = PAGE_ICONS[slug] ?? FileText;
  const isLegal = slug === "security";

  return (
    <main className="relative min-h-screen max-w-full overflow-x-hidden bg-[#F5F6F7] text-[#111827]">
      <SiteHeader />

      {/* Hero */}
      <section className="relative px-5 pt-40 pb-12 sm:pt-48 sm:pb-16">
        <div className="mx-auto max-w-3xl">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#5B6472] transition-colors hover:text-[#111827]"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to PerfectProperty
          </Link>
          <div className="mt-8 flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#0F172A] text-white shadow-sm">
              <Icon className="h-5 w-5" />
            </span>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#5B6472]">
              {page.eyebrow}
            </p>
          </div>
          <h1 className="mt-5 text-4xl font-semibold tracking-[-0.03em] text-[#111827] sm:text-5xl">
            {page.title}
          </h1>
          <p className="mt-6 text-lg leading-8 text-[#475569]">{page.intro}</p>
        </div>
      </section>

      {/* Content sections */}
      <section className="px-5 pb-20 sm:pb-28">
        <div className="mx-auto max-w-3xl">
          <div className="space-y-4">
            {page.sections.map((section, i) => (
              <section
                key={section.title}
                id={section.id}
                className="group scroll-mt-24 overflow-hidden rounded-2xl border border-[#E2E8F0] bg-white shadow-sm transition-all duration-200 hover:shadow-[0_4px_24px_rgba(15,23,42,0.06)]"
              >
                <div className="flex items-stretch">
                  <div className="flex w-12 shrink-0 items-center justify-center bg-[#F8FAFC] sm:w-14">
                    <span className="text-sm font-bold tabular-nums text-[#5B6472]">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <div className="flex-1 p-6 sm:p-7">
                    <h2 className="text-lg font-bold text-[#111827]">{section.title}</h2>
                    <p className="mt-2.5 leading-7 text-[#475569]">{section.body}</p>
                    {section.link && (section.link.href.startsWith("/") ? (
                      <Link
                        href={section.link.href}
                        className="mt-3 inline-flex items-center gap-1.5 text-sm font-bold text-slate-900 underline hover:text-slate-700"
                      >
                        {section.link.label}
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                      </Link>
                    ) : (
                      <a
                        href={section.link.href}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-flex items-center gap-1.5 text-sm font-bold text-slate-900 underline hover:text-slate-700"
                      >
                        {section.link.label}
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                      </a>
                    ))}
                  </div>
                </div>
              </section>
            ))}
          </div>

          {isLegal && (
            <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5">
              <p className="flex items-start gap-2 text-sm leading-relaxed text-amber-900">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <span>
                  <strong className="font-bold">Operator-authored.</strong>{" "}
                  These pages are operator-authored beta terms, not a counsel opinion.
                </span>
              </p>
            </div>
          )}

          {/* CTA */}
          <div className="mt-10 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <Link
              href="/listings"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-[#0F172A] px-6 text-sm font-bold text-white transition-colors hover:bg-[#1E293B]"
            >
              Open the live feed
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
