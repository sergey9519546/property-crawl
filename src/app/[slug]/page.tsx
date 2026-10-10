import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  ArrowLeft,
  Building2,
  FileText,
  ShieldCheck,
  Mail,
  Users,
  BookOpen,
  Scale,
  Lock,
  BarChart3,
  type LucideIcon,
} from "lucide-react";
import { SiteHeader } from "@/components/site/site-header";
import { SiteFooter } from "@/components/site/site-footer";
import { ContactForm } from "@/components/site/contact-form";

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
  resources: BookOpen,
  "case-studies": BarChart3,
  about: Users,
  contact: Mail,
  terms: Scale,
  privacy: Lock,
  security: ShieldCheck,
};

const INFO_PAGES: Record<string, InfoPage> = {
  enterprise: {
    eyebrow: "Enterprise",
    title: "One shared operator workspace.",
    intro: "PerfectProperty is a private beta. The workspace uses one shared operator credential. This build has no per-seat accounts, role list, or enterprise contract.",
    sections: [
      { title: "What you can use", body: "The live listing feed, the source catalog, saved searches inside the operator workspace, and the contact form." },
      { title: "What this build does not include", body: "There is no role-based access, no separate customer tenancy, and no published enterprise plan." },
      { title: "Ask the operator", body: "Use the contact form. The server stores the message. Email leaves the server only when Resend is configured, or when a webhook is configured and Resend is not.", link: { label: "Open the contact form", href: "/contact" } },
    ],
  },
  resources: {
    eyebrow: "Resources",
    title: "Where the beta actually is.",
    intro: "These links open the running product. They are not legal, title, tax, inspection, or investment advice.",
    sections: [
      { id: "knowledge-base", title: "Live feed", body: "Open a listing, read the source URL, and treat a missing score as withheld. A score appears only when the record has an observed value band.", link: { label: "Open listings", href: "/listings" } },
      { id: "blog", title: "Source catalog", body: "Each source row states whether a collector is promoted. IRS is a promoted official collector of the public real-estate auction index. GSA is a promoted official collector of the public accelerated-disposition list on gsa.gov, and it does not crawl realestatesales.gov. HUD collects every known jurisdiction unless HUD_STATES names a shorter list, and the page budget stays bounded.", link: { label: "Open sources", href: "/sources" } },
      { id: "changelog", title: "Collection activity", body: "Activity is the record of collector runs. A missing record after a complete index is an absence note. It is not a sold or closed claim.", link: { label: "Open activity", href: "/activity" } },
      { id: "guides", title: "States with a live count", body: "Open a state to see counties named on live records, with the observed count and the sources that contributed. A state appears only when the coverage feed reports a positive live count. These pages do not describe a market.", link: { label: "Open states", href: "/states" } },
      { id: "integrations", title: "What is wired", body: "A control is live only when its route, failure state, and data source are in this build. Checkout charges only when Stripe secrets are set, and it does not unlock operator APIs." },
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
  about: {
    eyebrow: "About",
    title: "The listing tells you what is for sale. The feed shows what it left out.",
    intro: "PerfectProperty reads public sale records and keeps the omitted fields visible. It does not invent a sale, a value, or a customer.",
    sections: [
      { title: "What exists today", body: "A Next.js interface, a Node API, a source catalog, live ingestion where a collector is promoted, notice parsing, a score only from an observed value band, an operator workspace, and export of records the feed holds." },
      { title: "Access", body: "Access is a shared operator credential. There is no public account store.", link: { label: "Operator sign-in", href: "/sign-in" } },
    ],
  },
  contact: {
    eyebrow: "Contact",
    title: "Talk to the operator.",
    intro: "Messages are stored for the operator. Outbound email is sent when Resend is configured. If Resend is not configured and a webhook is configured, the message is forwarded. Otherwise it stays in the local store.",
    sections: [
      { title: "Product feedback", body: "Use the live interface to identify broken workflows, unclear risk language, missing sources, and the filters the workspace needs." },
      { title: "Delivery status", body: "If the contact form says delivery is not configured yet, the message was saved for operator review and was not emailed." },
      { title: "Operator access", body: "There is no public self-serve account system. Access uses a shared operator credential.", link: { label: "Read the sign-in page", href: "/sign-in" } },
      { id: "careers", title: "Careers", body: "There are no open roles." },
    ],
  },
  terms: {
    eyebrow: "Legal",
    title: "Terms of use",
    intro: "Effective August 31, 2026. These are operator-authored beta terms, not a counsel opinion.",
    sections: [
      { title: "Informational use", body: "PerfectProperty provides research and workflow tools. It does not provide legal, tax, title, appraisal, brokerage, lending, or investment advice." },
      { title: "Verify every source", body: "Users must confirm sale status, bid requirements, liens, occupancy, redemption rights, and all property details with the official source and qualified professionals. A record absent from a later complete index is not a completed sale." },
      { title: "Maps and street imagery", body: "Google Street View may be shown as street-level context when a source-backed property lacks a publisher photo. A nearby panorama is not proof that the pictured facade is the subject property; users must verify the address and property identity independently. Google attribution remains visible." },
      { title: "Checkout", body: "If checkout is configured, Stripe hosts the payment page. Returning to this site does not create an account, record a paid flag, or unlock operator APIs.", link: { label: "Open checkout", href: "/checkout" } },
      { title: "Beta availability", body: "Features and data may change, be incomplete, or become unavailable. Do not rely on the beta as the sole basis for a financial decision." },
    ],
  },
  privacy: {
    eyebrow: "Legal",
    title: "Privacy notice",
    intro: "Effective August 31, 2026. This is an operator-authored beta notice, not a counsel opinion.",
    sections: [
      { title: "Data used by the interface", body: "Search terms, filters, and watchlist state are used to operate the product. When Street View fallback is enabled, source-observed property coordinates are sent server-to-server to Google to locate nearby imagery. Sensitive personal information should not be pasted into the beta notice parser." },
      { title: "Google Maps Platform", body: "The property media viewer may use Google Street View Static API content. Google receives the requested property coordinates and standard request metadata, and its handling of that information is governed by the Google Privacy Policy. PerfectProperty does not persist or re-host Street View image files.", link: { label: "Read the Google Privacy Policy", href: "https://policies.google.com/privacy" } },
      { title: "Email and checkout", body: "When RESEND_API_KEY and RESEND_FROM are set, newsletter and contact mail is sent through Resend. When they are not set, the message stays in the local form store unless a webhook is configured. Stripe is contacted only when checkout secrets are set. A browser return is not recorded as a paid account." },
      { title: "Newsletter removal", body: "An exact email match removes that address from the newsletter list. The control rewrites the newsletter store only. It does not delete contact messages, and there is no public account-deletion API.", link: { label: "Remove a newsletter address", href: "/newsletter/unsubscribe" } },
    ],
  },
  security: {
    eyebrow: "Trust",
    title: "Security and responsible use",
    intro: "The beta separates the public interface from the data API and validates untrusted notice text before it reaches downstream workflows.",
    sections: [
      { title: "Current controls", body: "The backend includes input validation, sanitization, rate limiting, bounded request bodies, AI prompt delimiters, and output validation tests. Scraper runs and workspace writes require the operator credential." },
      { title: "What is not in this beta", body: "There is no public account system and no separate disclosure program." },
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
  const isContact = slug === "contact";
  const isLegal = slug === "terms" || slug === "privacy" || slug === "security";

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
          {isContact && (
            <div className="mb-8 overflow-hidden rounded-3xl border border-[#E2E8F0] bg-white shadow-sm">
              <div className="border-b border-[#E2E8F0] bg-[#F8FAFC] px-6 py-5 sm:px-8">
                <h2 className="text-xl font-bold text-[#111827]">Send us a message</h2>
                <p className="mt-1 text-sm text-[#5B6472]">
                  Messages are stored for operator review. Outbound email is sent when Resend is configured, or forwarded when a webhook is configured and Resend is not. Otherwise the message stays on the server.
                </p>
              </div>
              <div className="p-6 sm:p-8">
                <ContactForm />
              </div>
            </div>
          )}

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
            {isContact && (
              <Link
                href="/about"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-[#D1D5DB] bg-white px-6 text-sm font-bold text-[#0F172A] transition-colors hover:bg-[#F5F6F7]"
              >
                Learn about PerfectProperty
                <ArrowRight className="h-4 w-4" />
              </Link>
            )}
          </div>
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
