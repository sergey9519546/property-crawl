import Link from "next/link";
import { notFound } from "next/navigation";

type InfoSection = {
  id?: string;
  title: string;
  body: string;
};

type InfoPage = {
  eyebrow: string;
  title: string;
  intro: string;
  sections: InfoSection[];
};

const INFO_PAGES: Record<string, InfoPage> = {
  enterprise: {
    eyebrow: "Enterprise",
    title: "Build a repeatable distressed-property pipeline.",
    intro: "PerfectProperty is in private beta. Enterprise access focuses on shared watchlists, data exports, audit-ready underwriting, and source coverage tailored to an acquisitions team.",
    sections: [
      { title: "Team workflows", body: "Centralize triage, underwriting notes, and watchlist decisions so acquisitions, disposition, and capital teams work from the same record." },
      { title: "Data and controls", body: "Production deployments will include source-level provenance, export controls, role-based access, and documented retention policies." },
      { title: "Early access", body: "Use the live feed to evaluate the current product surface. Contact and onboarding details will be published before the public beta." },
    ],
  },
  resources: {
    eyebrow: "Resources",
    title: "Practical guidance for finding and underwriting public-sale deals.",
    intro: "These resources describe the product’s current beta workflows. They do not replace legal, title, tax, inspection, or investment advice.",
    sections: [
      { id: "blog", title: "Field notes", body: "Source-by-source collection notes, county workflow changes, and product updates will appear here as the live data pipeline is verified." },
      { id: "knowledge-base", title: "Knowledge base", body: "Start in the live feed, filter by geography and source, open a deal, review legal terms, and save only the properties that merit independent due diligence." },
      { id: "guides", title: "County guides", body: "Every jurisdiction has different deposits, redemption rules, confirmation timelines, and title risks. Confirm the official notice and local rules before bidding." },
      { id: "changelog", title: "Changelog", body: "The Next.js application is now the canonical interface. Live API integration, honest ingestion state, and interaction testing are the active release focus." },
      { id: "integrations", title: "Integrations", body: "The interface currently demonstrates the intended integration surface. An integration is not considered live until its API, authentication, failure states, and data provenance are verified." },
    ],
  },
  "case-studies": {
    eyebrow: "Case studies",
    title: "Beta outcomes are being validated.",
    intro: "The customer names and performance figures shown in the current marketing composition are illustrative design content, not published customer claims. Verified case studies will replace them before launch.",
    sections: [
      { id: "blueline-capital", title: "Sourcing workflow", body: "Measure whether a unified feed reduces the time required to identify a property worth underwriting." },
      { id: "northstar-flips", title: "Offer workflow", body: "Measure the handoff from notice parsing to deal review, watchlist, source verification, and offer decision." },
      { id: "oakshire-properties", title: "Portfolio workflow", body: "Measure repeatability, source coverage, false-positive rate, and realized outcomes once production data is connected." },
    ],
  },
  about: {
    eyebrow: "About",
    title: "A clearer way to triage distressed property.",
    intro: "PerfectProperty brings fragmented government, GSE, and county-sale information into one review workflow, then makes the assumptions and risks visible before a buyer commits funds.",
    sections: [
      { title: "What exists today", body: "The beta includes a Next.js product interface, a separate Node API, source taxonomy, sample and scraped datasets, notice parsing, deal scoring, watchlists, and export flows." },
      { title: "What comes next", body: "The priority is verified real listings with source-specific URLs, reliable ingestion, persistent accounts, and transparent model and data quality reporting." },
    ],
  },
  contact: {
    eyebrow: "Contact",
    title: "Talk to the PerfectProperty team.",
    intro: "The project is currently in private beta. A monitored support address and production service channels will be added before public access.",
    sections: [
      { title: "Product feedback", body: "Use the live interface to identify broken workflows, unclear risk language, missing sources, and the filters your acquisitions process needs." },
      { id: "careers", title: "Careers", body: "There are no open roles published at this time. Future engineering and data-operations roles will be listed here." },
    ],
  },
  terms: {
    eyebrow: "Legal",
    title: "Terms of use — beta draft",
    intro: "Effective August 31, 2026. These beta terms are a working draft and require legal review before public launch.",
    sections: [
      { title: "Informational use", body: "PerfectProperty provides research and workflow tools. It does not provide legal, tax, title, appraisal, brokerage, lending, or investment advice." },
      { title: "Verify every source", body: "Users must confirm sale status, bid requirements, liens, occupancy, redemption rights, and all property details with the official source and qualified professionals." },
      { title: "Beta availability", body: "Features and data may change, be incomplete, or become unavailable. Do not rely on the beta as the sole basis for a financial decision." },
    ],
  },
  privacy: {
    eyebrow: "Legal",
    title: "Privacy notice — beta draft",
    intro: "Effective August 31, 2026. The local beta uses browser state for interactive demonstrations and may use hosting logs when deployed.",
    sections: [
      { title: "Data used by the interface", body: "Search terms, filters, and watchlist state are used to operate the product. Sensitive personal information should not be pasted into the beta notice parser." },
      { title: "Service providers", body: "A production privacy notice will identify hosting, authentication, analytics, email, and AI providers before those services are enabled for public users." },
      { title: "Retention and deletion", body: "Production retention periods and deletion controls will be documented before account-based persistence is launched." },
    ],
  },
  security: {
    eyebrow: "Trust",
    title: "Security and responsible use",
    intro: "The beta separates the public interface from the data API and validates untrusted notice text before it reaches downstream workflows.",
    sections: [
      { title: "Current controls", body: "The backend includes input validation, sanitization, rate limiting, bounded request bodies, AI prompt delimiters, and output validation tests." },
      { title: "Before public launch", body: "Production work includes authenticated scraper controls, secret management, database least privilege, dependency review, monitoring, incident response, and an external security review." },
      { title: "Reporting", body: "A dedicated vulnerability-reporting channel and disclosure policy will be published before the service accepts public accounts." },
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

  return (
    <main className="min-h-screen bg-[#F5F6F7] px-5 py-16 text-[#111827] sm:py-24">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm font-semibold text-[#0F172A] hover:underline">
          ← Back to PerfectProperty
        </Link>
        <p className="mt-12 text-xs font-bold uppercase tracking-[0.18em] text-[#64748B]">{page.eyebrow}</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">{page.title}</h1>
        <p className="mt-6 text-lg leading-8 text-[#475569]">{page.intro}</p>
        <div className="mt-12 space-y-5">
          {page.sections.map((section) => (
            <section key={section.title} id={section.id} className="scroll-mt-8 rounded-2xl border border-[#E2E8F0] bg-white p-6 shadow-sm">
              <h2 className="text-xl font-bold">{section.title}</h2>
              <p className="mt-3 leading-7 text-[#475569]">{section.body}</p>
            </section>
          ))}
        </div>
        <Link href="/#live-feed" className="mt-10 inline-flex rounded-xl bg-[#0F172A] px-5 py-3 text-sm font-bold text-white hover:bg-[#1E293B]">
          Open the live feed
        </Link>
      </div>
    </main>
  );
}
