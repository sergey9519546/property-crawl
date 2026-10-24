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
    eyebrow: "For teams",
    title: "Using PerfectProperty with a team",
    intro: "We sell individual memberships today. There is no team plan yet, with shared logins or different access levels for each person.",
    sections: [
      { title: "What you can do now", body: "Anyone can browse listings, the map and the calendar for free. Each person on your team can become a member for hunts with email alerts, saved searches and a watchlist." },
      { title: "What we don't have yet", body: "No team plan, no shared accounts, no separate access levels, and no team contract." },
      { title: "Want one for your team?", body: "Tell us how many people you have and what you need. Your message is saved and read, though we can't promise a reply time.", link: { label: "Contact us", href: "/contact" } },
    ],
  },
  "case-studies": {
    eyebrow: "Examples",
    title: "How buyers use PerfectProperty",
    intro: "We don't have customer stories to share yet. These are examples of how a buyer might use the site, not real customers or results.",
    sections: [
      { id: "sourcing", title: "Example: a small landlord looking for a duplex", body: "Search your county, filter to sheriff sales, and, as a member, set up a hunt for duplexes under your budget. You get an email when a new one fits." },
      { id: "review", title: "Example: checking one listing before you bid", body: "Open the listing and read the catch: redemption period, liens, occupancy and deposit terms. Then follow the link to the original notice and check title yourself." },
      { id: "outcomes", title: "What we don't claim", body: "We don't report sales results, savings or customer quotes. For the basics, see our buyer's guide.", link: { label: "Read the buyer's guide", href: "/resources" } },
    ],
  },
  security: {
    eyebrow: "Security",
    title: "Security and responsible use",
    intro: "Here is what we do today to protect the site and your account. We don't hold any security certifications.",
    sections: [
      { title: "What we do", body: "We check what you submit and limit repeated requests. Member sign-in uses a one-time email link, so there is no password to steal. Payments are handled by Stripe, so we never see your card number." },
      { title: "What we don't have", body: "We don't hold security certifications, and we don't run a formal bug-reporting program." },
      { title: "Report a problem", body: "Found a security problem? Use the contact form. It is the only channel we have right now.", link: { label: "Contact us", href: "/contact" } },
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
                  <strong className="font-bold">Plain-language summary.</strong>{" "}
                  This page is a plain description, not legal advice.
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
              Browse listings
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
