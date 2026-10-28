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
  cta: { heading: string; body: string; label: string; href: string };
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
    intro: "Everyone on your team can use PerfectProperty today, each with their own account. There is no shared team plan yet.",
    sections: [
      { title: "What your team can do now", body: "Anyone can browse listings, the map and the sale calendar for free. Each person can become a member for hunts, email alerts, saved searches and a watchlist." },
      { title: "What a team can't get yet", body: "No shared logins, no different access levels for each person, and no team contract." },
      { title: "Need more than that?", body: "Tell us how many people you have and what you need. Your message is saved and read, but we can't promise a reply time.", link: { label: "Contact us", href: "/contact" } },
    ],
    cta: { heading: "Start with the free listings", body: "See what is up for sale near you, with the catch shown first.", label: "Browse listings", href: "/listings" },
  },
  "case-studies": {
    eyebrow: "Examples",
    title: "How buyers use PerfectProperty",
    intro: "We have no customer stories to share yet. These are examples of how a buyer might use the site, not real customers or results.",
    sections: [
      { id: "sourcing", title: "A small landlord looking for a duplex", body: "Search your county and filter to sheriff sales. As a member, set up a hunt for duplexes under your budget. You get an email when a new one fits." },
      { id: "review", title: "Checking one listing before you bid", body: "Open the listing and read the catch: redemption period, liens, occupancy and deposit. Then follow the link to the original notice and check title yourself." },
      { id: "outcomes", title: "New to auctions?", body: "Start with the buyer's guide. It explains how these sales work in plain English.", link: { label: "Read the buyer's guide", href: "/resources" } },
    ],
    cta: { heading: "Try it on a real sale", body: "Pick a listing and read its catch before anything else.", label: "Browse listings", href: "/listings" },
  },
  security: {
    eyebrow: "Security",
    title: "Security and responsible use",
    intro: "Here is how we protect the site and your account today.",
    sections: [
      { title: "What we do", body: "We check what you submit and limit repeated requests. Member sign-in uses a one-time email link, so there is no password to steal. Payments are handled by Stripe, so we never see your card number." },
      { title: "What we don't have", body: "We don't hold any security certifications, and we don't run a formal bug-reporting program." },
      { title: "Report a problem", body: "Found a security problem? Use the contact form. It is the only channel we have right now.", link: { label: "Contact us", href: "/contact" } },
    ],
    cta: { heading: "Questions about your account?", body: "Send us a note and we will read it.", label: "Contact us", href: "/contact" },
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
    <main className="relative min-h-screen max-w-full overflow-x-hidden bg-paper text-ink">
      <SiteHeader />

      <section className="relative px-5 pt-40 pb-10 sm:pt-48 sm:pb-14">
        <div className="mx-auto max-w-3xl">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-3 transition-colors hover:text-ink"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to PerfectProperty
          </Link>
          <div className="mt-8 flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-ink text-white shadow-sm">
              <Icon className="h-5 w-5" />
            </span>
            <p className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-2">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {page.eyebrow}
            </p>
          </div>
          <h1 className="mt-6 text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.03em] text-ink sm:text-5xl">
            {page.title}
          </h1>
          <p className="mt-5 max-w-[620px] text-pretty text-lg leading-8 text-ink-2">{page.intro}</p>
        </div>
      </section>

      <section className="px-5 pb-20 sm:pb-28">
        <div className="mx-auto max-w-3xl">
          <div className="space-y-4">
            {page.sections.map((section, i) => (
              <section
                key={section.title}
                id={section.id}
                className="scroll-mt-24 rounded-3xl border border-line bg-white p-6 shadow-sm sm:p-8"
              >
                <div className="flex items-start gap-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-paper text-sm font-semibold tabular-nums text-ink-2">
                    {i + 1}
                  </span>
                  <div>
                    <h2 className="text-xl font-semibold tracking-[-0.01em] text-ink">{section.title}</h2>
                    <p className="mt-2 text-pretty text-[16px] leading-7 text-ink-2">{section.body}</p>
                    {section.link && (
                      <Link
                        href={section.link.href}
                        className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-ink underline underline-offset-4 hover:text-ink-2"
                      >
                        {section.link.label}
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                      </Link>
                    )}
                  </div>
                </div>
              </section>
            ))}
          </div>

          {isLegal && (
            <p className="mt-4 px-2 text-sm leading-6 text-ink-3">
              This page is a plain description, not legal advice.
            </p>
          )}

          <div className="mt-10 rounded-3xl bg-ink p-8 text-white sm:p-10">
            <h2 className="text-2xl font-semibold tracking-[-0.02em]">{page.cta.heading}</h2>
            <p className="mt-2 max-w-[520px] text-[16px] leading-7 text-slate-300">{page.cta.body}</p>
            <Link
              href={page.cta.href}
              className="mt-6 inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-white px-6 text-sm font-semibold text-ink transition-colors hover:bg-slate-100"
            >
              {page.cta.label}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
