"use client";

import * as React from "react";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Calendar,
  Calculator,
  CheckCircle2,
  ChevronLeft,
  Database,
  DollarSign,
  FileText,
  Landmark,
  Scale,
  Search,
  ShieldCheck,
} from "lucide-react";
import dynamic from "next/dynamic";
import { SectionHeading } from "./section-heading";
import { Fact, YoursTag, type FactFormat } from "@/components/evidence/fact";
import { factText } from "@/lib/evidence";

/**
 * The atlas is a MapLibre GL canvas — around 1 MB of JavaScript, shipped as one
 * shared chunk that the terminal map and the listing media viewer also use.
 *
 * It mounts at stage "find", long after first paint, so it has no business in
 * the initial bundle. Lazy-loading it keeps that megabyte off the critical path
 * until the section is actually near the viewport.
 *
 * The placeholder repeats the map's exact responsive height so the swap cannot
 * shift the layout: the page currently scores CLS 0.00 and this must not trade
 * that for a cheaper first paint.
 */
const OpportunityAtlas = dynamic(
  () => import("./deal-discovery-map").then((m) => m.DealDiscoveryMap),
  {
    ssr: false,
    loading: AtlasPlaceholder,
  },
);

/** The map's exact responsive height, so mounting it later cannot shift layout. */
function AtlasPlaceholder() {
  return (
    <div
      aria-hidden
      className="opportunity-atlas__map relative h-[390px] overflow-hidden sm:h-[480px] lg:h-[620px]"
    />
  );
}

/**
 * The atlas is a MapLibre GL canvas. The engine ships as one ~1 MB shared chunk
 * (the same one the terminal's map and the listing media viewer use), and this
 * component's useEffect calls `import("maplibre-gl")` on mount.
 *
 * The dynamic import alone was not enough, and the trace proved why: the story
 * machine's default stage IS "find", so the atlas mounts on first paint, its
 * chunk is requested immediately, and the megabyte is fetched inside the
 * critical window. This section is the fourth on the page, so nobody can see
 * the map without scrolling to it. One listener defers it until a visitor is
 * actually about to look at it.
 */
function DeferredOpportunityAtlas() {
  const [inView, setInView] = React.useState(false);
  const hostRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host || inView) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      // Begin the import slightly before the section is on screen, so the swap
      // is not visibly late on a fast scroll.
      { rootMargin: "400px" },
    );
    observer.observe(host);
    return () => observer.disconnect();
  }, [inView]);

  return <div ref={hostRef}>{inView ? <OpportunityAtlas /> : <AtlasPlaceholder />}</div>;
}

type StageKey = "find" | "verify" | "underwrite" | "act";

type StageDefinition = {
  key: StageKey;
  step: string;
  label: string;
  summary: string;
  eyebrow: string;
  headline: string;
  description: string;
  output: string;
  icon: typeof Search;
};

const STAGES: StageDefinition[] = [
  {
    key: "find",
    step: "01",
    label: "Find",
    summary: "Search by place",
    eyebrow: "Step 1",
    headline: "Upcoming sales near you, in one list.",
    description:
      "Search a city, county or ZIP. See upcoming auction and government sales on a map, a list and a calendar.",
    output: "A list of upcoming sales",
    icon: Search,
  },
  {
    key: "verify",
    step: "02",
    label: "Verify",
    summary: "Check the catch",
    eyebrow: "Step 2",
    headline: "See the catch before you bid.",
    description:
      "Each listing shows what was posted, what is missing, and a link to the original notice. Check title and condition yourself before you bid.",
    output: "Facts with a link to the source",
    icon: ShieldCheck,
  },
  {
    key: "underwrite",
    step: "03",
    label: "Underwrite",
    summary: "Set your top bid",
    eyebrow: "Step 3",
    headline: "Set your own top bid.",
    description:
      "Enter what you think it is worth, plus repairs and your target profit. See the most you can bid and still hit it.",
    output: "Your maximum bid",
    icon: Calculator,
  },
  {
    key: "act",
    step: "04",
    label: "Act",
    summary: "Track what you like",
    eyebrow: "Step 4",
    headline: "Keep the winners. Get an email on new ones.",
    description:
      "Save properties to your watchlist. Members can start a hunt and get an email when a new listing fits or a saved one changes.",
    output: "A short list with sale dates",
    icon: FileText,
  },
];

type PublishedListing = {
  id: string;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  county?: string | null;
  source?: string | null;
  openingBid?: number | string | null;
  saleDate?: string | null;
  deposit?: number | string | null;
  dealScore?: number | string | null;
  occupancy?: string | null;
  parcelKey?: string | null;
};

type PublishedState = {
  listing: PublishedListing | null;
  status: "loading" | "ready" | "empty" | "error";
  modeledCeiling: number | null;
  setModeledCeiling: (ceiling: number | null) => void;
};

const PublishedListingContext = React.createContext<PublishedState>({
  listing: null,
  status: "loading",
  modeledCeiling: null,
  setModeledCeiling: () => {},
});

function moneyText(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return "Not listed";
  return `$${Math.round(n).toLocaleString()}`;
}

function formatDollars(value: unknown, fallback = "—"): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return `$${Math.round(n).toLocaleString()}`;
}

function useLoadPublishedListing(): { listing: PublishedListing | null; status: "loading" | "ready" | "empty" | "error" } {
  const [state, setState] = React.useState<{ listing: PublishedListing | null; status: "loading" | "ready" | "empty" | "error" }>({ listing: null, status: "loading" });
  React.useEffect(() => {
    let cancelled = false;
    void fetch("/api/listings?limit=1&sort=date", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data: { listings?: PublishedListing[] }) => {
        if (cancelled) return;
        const listing = data.listings?.[0] ?? null;
        setState({ listing, status: listing ? "ready" : "empty" });
      })
      .catch(() => {
        if (!cancelled) setState({ listing: null, status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

export function Storyteller() {
  const published = useLoadPublishedListing();
  const [stage, setStage] = React.useState<StageKey>("find");
  const [modeledCeiling, setModeledCeiling] = React.useState<number | null>(null);
  const tabRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = STAGES.findIndex((item) => item.key === stage);
  const activeStage = STAGES[activeIndex];

  const selectFromKeyboard = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let nextIndex = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % STAGES.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + STAGES.length) % STAGES.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = STAGES.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    setStage(STAGES[nextIndex].key);
    // All tab buttons stay mounted — only selection styling changes — so the
    // target can be focused synchronously. Deferring via rAF was flaky under
    // load (frame could land after the next assertion).
    tabRefs.current[nextIndex]?.focus();
  };

  const headline = published.listing?.address
    || (published.status === "loading" ? "Loading a sample listing" : published.status === "error" ? "Listing unavailable right now" : "No listing to show yet");
  const place = [published.listing?.city, published.listing?.state].filter(Boolean).join(", ");

  const contextValue = React.useMemo<PublishedState>(
    () => ({
      ...published,
      modeledCeiling,
      setModeledCeiling,
    }),
    [published, modeledCeiling]
  );

  return (
    <PublishedListingContext.Provider value={contextValue}>
    <section id="product" className="relative isolate overflow-hidden py-24 sm:py-28">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-20 -z-10 h-[620px] w-[min(1320px,96vw)] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(209,213,219,0.45),rgba(229,231,235,0.3)_46%,transparent_73%)] blur-3xl"
      />

      <div className="mx-auto max-w-[1280px] px-5 lg:px-8">
        <SectionHeading eyebrow="How it works" title="Four steps from first look to bid day.">
          The same order an experienced bidder follows. Click through them with a real listing.
        </SectionHeading>

        <div className="mt-14 overflow-hidden rounded-[28px] border border-card/90 bg-card/90 shadow-raised backdrop-blur-xl">
            <div className="flex flex-col gap-3 border-b border-line bg-card/90 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-ink">
                  Property decision workflow
                </p>
                <p className="mt-1 text-[16px] font-semibold text-ink">
                  {headline}
                  {place ? <span className="ml-2 font-medium text-ink-3">{place}</span> : null}
                </p>
              </div>
              <span className="inline-flex w-fit items-center gap-2 rounded-full border border-line-strong bg-paper px-3 py-1.5 text-[11px] font-bold text-ink-2">
                <span className="h-2 w-2 rounded-full bg-ink-3" aria-hidden />
                {published.status === "ready" ? "Next sale" : headline}
              </span>
            </div>

            <div
              role="tablist"
              aria-label="Property decision workflow"
              className="relative grid grid-cols-2 gap-px border-b border-line bg-line sm:grid-cols-4"
            >
              {STAGES.map((item, index) => {
                const selected = item.key === stage;
                return (
                  <button
                    key={item.key}
                    ref={(node) => {
                      tabRefs.current[index] = node;
                    }}
                    id={`storyteller-tab-${item.key}`}
                    role="tab"
                    type="button"
                    tabIndex={selected ? 0 : -1}
                    aria-selected={selected}
                    aria-controls="storyteller-panel"
                    onClick={() => setStage(item.key)}
                    onKeyDown={(event) => selectFromKeyboard(event, index)}
                    className={`group relative min-h-[82px] bg-card px-3 py-4 text-left transition-colors sm:min-h-[94px] sm:px-5 ${
                      selected ? "text-ink" : "text-ink-3 hover:bg-paper"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`absolute inset-x-0 top-0 h-[3px] transition-colors ${
                        selected ? "bg-ink" : "bg-transparent"
                      }`}
                    />
                    <span className="flex items-start gap-2 sm:gap-3">
                      <span
                        className={`grid h-8 w-8 shrink-0 place-items-center rounded-[10px] text-[10px] font-extrabold transition-colors sm:h-9 sm:w-9 sm:rounded-xl sm:text-[11px] ${
                          selected
                            ? "bg-ink text-white"
                            // The step number was once flagged for insufficient
                            // contrast (4.34:1 against a 4.5:1 requirement).
                            // text-ink-3 on paper measures 5.9:1 (AA) and still
                            // reads as clearly unselected.
                            : "bg-paper text-ink-3 group-hover:bg-line"
                        }`}
                      >
                        {item.step}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[12px] font-extrabold tracking-[-0.01em] sm:text-[15px] sm:tracking-normal">
                          {item.label}
                        </span>
                        <span className="mt-0.5 block text-[10px] font-semibold leading-[1.3] text-ink-3 sm:text-[11px]">
                          {item.summary}
                        </span>
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div
              id="storyteller-panel"
              role="tabpanel"
              aria-labelledby={`storyteller-tab-${stage}`}
              data-testid="storyteller-stage"
              data-stage={stage}
            >
              <div className="grid gap-4 border-b border-line bg-paper px-5 py-5 sm:grid-cols-[1fr_auto] sm:items-center sm:px-7">
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-ink">
                    {activeStage.step} · {activeStage.eyebrow}
                  </p>
                  <h3 className="mt-1 text-[23px] font-bold tracking-[-0.02em] text-ink">
                    {activeStage.headline}
                  </h3>
                  <p className="mt-1.5 max-w-[720px] text-[13px] font-medium leading-[1.55] text-ink-3 sm:text-[14px]">
                    {activeStage.description}
                  </p>
                </div>
                <div className="rounded-2xl border border-line bg-card px-4 py-3 shadow-sm">
                  <p className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-ink-3">
                    Output
                  </p>
                  <p className="mt-1 text-[13px] font-bold text-ink">
                    {activeStage.output}
                  </p>
                </div>
              </div>

              <div className={stage === "find" ? "p-3 sm:p-5" : "p-5 sm:p-7"}>
                <ProductContent stage={stage} />
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-line bg-card px-5 py-4 sm:px-7">
              <div className="hidden items-center gap-2 text-[11px] font-semibold text-ink-3 sm:flex">
                <span className="text-ink">{activeIndex + 1} of {STAGES.length}</span>
                <span aria-hidden>·</span>
                <span>The same property in every step</span>
              </div>
              <div className="ml-auto flex items-center gap-2">
                {activeIndex > 0 ? (
                  <button
                    type="button"
                    onClick={() => setStage(STAGES[activeIndex - 1].key)}
                    className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-line-strong bg-card px-4 text-[12px] font-bold text-ink-2 hover:bg-paper"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> Back
                  </button>
                ) : null}
                {activeIndex < STAGES.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => setStage(STAGES[activeIndex + 1].key)}
                    className="inline-flex h-11 items-center gap-2 rounded-xl bg-ink px-4 text-[12px] font-bold text-white hover:bg-ink-2"
                  >
                    Next: {STAGES[activeIndex + 1].label}
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </button>
                ) : (
                  <a
                    href="/listings"
                    className="inline-flex h-11 items-center gap-2 rounded-xl bg-ink px-4 text-[12px] font-bold text-white hover:bg-ink-2"
                  >
                    Browse listings <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </a>
                )}
              </div>
            </div>
          </div>
      </div>
    </section>
    </PublishedListingContext.Provider>
  );
}

function ProductContent({ stage }: { stage: StageKey }) {
  if (stage === "find") return <DeferredOpportunityAtlas />;
  if (stage === "verify") return <VerificationPanel />;
  if (stage === "underwrite") return <UnderwritePanel />;
  return <ActionPanel />;
}

function VerificationPanel() {
  const { listing, status } = React.useContext(PublishedListingContext);
  const checks = [
    { icon: Landmark, label: "Opening amount", detail: moneyText(listing?.openingBid) },
    { icon: Building2, label: "Parcel number", detail: factText(listing?.parcelKey) ?? "Not listed" },
    { icon: Database, label: "Sale date", detail: factText(listing?.saleDate, "date") ?? "Not listed" },
    { icon: Scale, label: "Occupancy", detail: factText(listing?.occupancy) ?? "Not listed" },
  ];

  return (
    <div data-testid="storyteller-verify" className="grid min-h-[480px] gap-5 lg:grid-cols-[0.88fr_1.12fr]">
      <article className="relative overflow-hidden on-ink rounded-card bg-ink p-6 text-white shadow-overlay sm:p-8">
        <div aria-hidden className="absolute -right-14 -top-14 h-56 w-56 rounded-full bg-white/10 blur-3xl" />
        <p className="relative text-[10px] font-extrabold uppercase tracking-[0.16em] text-white/75">
          Next sale
        </p>
        <h4 className="relative mt-3 text-[28px] font-bold tracking-[-0.03em]">{listing?.address || (status === "loading" ? "Loading a sample listing" : "No listing to show yet")}</h4>
        <p className="relative mt-1 text-[13px] font-medium text-white/75">{[listing?.county, listing?.state].filter(Boolean).join(", ") || listing?.source || "Details from the listing"}</p>

        <dl className="relative mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-white/10">
          <EvidenceFact label="Source" value={listing?.source} />
          <EvidenceFact label="Opening" value={listing?.openingBid} format="money" />
          <EvidenceFact label="Sale date" value={listing?.saleDate} format="date" />
          <EvidenceFact label="Deposit" value={listing?.deposit} />
        </dl>

        <div className="relative mt-6 rounded-2xl border border-white/10 bg-white/[0.06] p-4">
          <div className="flex items-center gap-2 text-[11px] font-bold text-white">
            <FileText className="h-4 w-4 text-white/75" aria-hidden /> What the listing says
          </div>
          <p className="mt-2 text-[12px] leading-[1.55] text-white/75">
            {listing?.id ? "These details come straight from the listing. Check the original notice before you bid." : "We could not load a listing just now."}
          </p>
        </div>
      </article>

      <article className="rounded-[24px] border border-line bg-card p-5 shadow-sm sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-ink-3">Quick check</p>
            <h4 className="mt-1 text-[20px] font-bold text-ink">What we know, and what is missing</h4>
          </div>
          <ShieldCheck className="h-7 w-7 text-ink-3" aria-hidden />
        </div>
        <div className="mt-5 space-y-2.5">
          {checks.map((check) => (
            <div key={check.label} className="flex items-start gap-3 rounded-2xl border border-line bg-paper p-4">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-card text-ink-2 shadow-sm">
                <check.icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-bold text-ink">{check.label}</span>
                <span className="mt-0.5 block text-[11px] font-medium leading-[1.45] text-ink-3">{check.detail}</span>
              </span>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-[0.08em] ${
                check.detail === "Not listed"
                  ? "bg-catch-wash text-catch-ink"
                  : "bg-line text-ink-2"
              }`}>
                {check.detail === "Not listed" ? "Not listed" : "Listed"}
              </span>
            </div>
          ))}
        </div>
      </article>
    </div>
  );
}

function EvidenceFact({ label, value, format }: { label: string; value: unknown; format?: FactFormat }) {
  return (
    <div className="bg-white/[0.06] p-4">
      <dt className="text-[9px] font-extrabold uppercase tracking-[0.12em] text-white/60">{label}</dt>
      <dd className="mt-1 text-[13px] font-bold text-white"><Fact value={value} format={format} /></dd>
    </div>
  );
}

function UnderwritePanel() {
  const { listing, setModeledCeiling } = React.useContext(PublishedListingContext);
  const openingN = Number(listing?.openingBid);
  const opening = Number.isFinite(openingN) && openingN > 0 ? openingN : null;
  const [assumed, setAssumed] = React.useState(0);
  const [repairs, setRepairs] = React.useState(0);
  const [carry, setCarry] = React.useState(0);
  const [profit, setProfit] = React.useState(0);

  // No starting values: a value derived from the opening bid would be invented
  // data shown as "yours" (zero-fabrication rule). Every number starts at 0.

  const ceiling = assumed > 0 ? Math.max(0, assumed - repairs - carry - profit) : null;
  const offerRoom = ceiling !== null && opening !== null ? Math.max(0, ceiling - opening) : null;
  const dollars = (n: number) => `$${Math.round(n).toLocaleString()}`;
  const bar = (amount: number) => (assumed > 0 ? `${Math.max(0, Math.min(100, Math.round((amount / assumed) * 100)))}%` : "0%");

  React.useEffect(() => {
    setModeledCeiling(ceiling);
  }, [ceiling, setModeledCeiling]);

  const deductions = [
    {
      label: "Assumed value",
      value: assumed > 0 ? dollars(assumed) : "Not entered",
      width: "100%",
      color: "bg-yours",
      min: 0,
      max: Math.max(500000, Math.round((assumed || 300000) * 1.5)),
      current: assumed,
      onChange: setAssumed as ((v: number) => void) | undefined,
    },
    {
      label: "Repairs",
      value: dollars(repairs),
      width: bar(Math.max(0, assumed - repairs)),
      color: "bg-yours/70",
      min: 0,
      max: Math.max(200000, Math.round((assumed || 300000) * 0.5)),
      current: repairs,
      onChange: setRepairs,
    },
    {
      label: "Carry + close",
      value: dollars(carry),
      width: bar(Math.max(0, assumed - repairs - carry)),
      color: "bg-yours/50",
      min: 0,
      max: Math.max(100000, Math.round((assumed || 300000) * 0.25)),
      current: carry,
      onChange: setCarry,
    },
    {
      label: "Required profit",
      value: dollars(profit),
      width: bar(ceiling ?? 0),
      color: "bg-yours/35",
      min: 0,
      max: Math.max(200000, Math.round((assumed || 300000) * 0.4)),
      current: profit,
      onChange: setProfit,
    },
  ];

  return (
    <div data-testid="storyteller-underwrite" className="grid min-h-[480px] gap-5 lg:grid-cols-[1.2fr_0.8fr]">
      <article className="rounded-[24px] border border-line bg-card p-6 shadow-sm sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-ink">Your numbers</p>
            <h4 className="mt-1 text-[22px] font-bold tracking-[-0.02em] text-ink">Work out your top bid</h4>
            <p className="mt-1 text-[12px] font-medium text-ink-3">Change any number. These are your estimates, not ours.</p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-xl bg-paper px-3 py-2 text-[11px] font-bold text-ink">
            <Calculator className="h-4 w-4" aria-hidden /> Value minus costs
          </span>
        </div>

        <div className="mt-7 space-y-4" aria-label="Value minus costs">
          {deductions.map((item) => (
            <div key={item.label}>
              <div className="flex items-center justify-between text-[12px] font-bold">
                <span className="text-ink-3">{item.label}</span>
                <span className="tabular-nums text-ink">{item.value}</span>
              </div>
              {item.onChange ? (
                <input
                  type="range"
                  aria-label={`Adjust ${item.label} in dollars`}
                  step={1000}
                  min={item.min}
                  max={item.max}
                  value={item.current}
                  onChange={(e) => item.onChange?.(Number(e.target.value))}
                  className="mt-2 h-2.5 w-full cursor-pointer accent-[var(--color-yours)]"
                />
              ) : (
                <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-line">
                  <div className={`h-full rounded-full ${item.color}`} style={{ width: item.width }} />
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-8 grid grid-cols-3 gap-2 rounded-2xl bg-paper p-2">
          <ModelStat label="Opening bid" value={<Fact value={opening} format="money" />} />
          <ModelStat label="Top bid" value={ceiling === null ? "Not entered" : <Fact value={ceiling} format="money" origin="yours" />} emphasis />
          <ModelStat label="Offer room" value={offerRoom === null ? (ceiling !== null && opening === null ? "Needs an opening bid" : "Not entered") : <Fact value={offerRoom} format="money" origin="yours" />} />
        </div>
      </article>

      <article className="flex flex-col on-ink rounded-card bg-ink p-6 text-white shadow-overlay sm:p-8">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-white/75">Decision</p>
        <p className="mt-3 text-[13px] font-semibold text-white/75">Your top bid <YoursTag /></p>
        <p className="mt-1 text-[42px] font-bold tracking-[-0.04em] text-white">{ceiling === null ? "Enter your numbers" : <Fact value={ceiling} format="money" origin="yours" />}</p>
        <p className="mt-1 text-[12px] text-white/60">Built from the numbers you entered, so it is only as good as they are.</p>
        <div className="mt-5 h-px bg-white/10" />
        <div className="mt-5 space-y-4">
          <DecisionLine icon={DollarSign} label="Opening bid" value={<Fact value={opening} format="money" />} />
          <DecisionLine icon={AlertTriangle} label="Deposit" value={<Fact value={listing?.deposit} />} />
          <DecisionLine icon={Calendar} label="Sale date" value={<Fact value={listing?.saleDate} format="date" />} />
        </div>
        <div className="mt-auto rounded-2xl border border-catch/30 bg-catch/10 p-4">
          <p className="text-[11px] font-bold text-[#ffb59f]">Occupancy</p>
          <p className="mt-1 text-[11px] leading-[1.5] text-white/75">
            {factText(listing?.occupancy) ? `Occupancy: ${factText(listing?.occupancy)}.` : "The listing does not say if anyone lives there."}
          </p>
        </div>
      </article>
    </div>
  );
}

function ModelStat({ label, value, emphasis }: { label: string; value: React.ReactNode; emphasis?: boolean }) {
  return (
    <div className={`rounded-xl px-3 py-4 text-center ${emphasis ? "on-ink bg-ink text-white" : "bg-card text-ink"}`}>
      <p className={`text-[9px] font-extrabold uppercase tracking-[0.08em] ${emphasis ? "text-white/60" : "text-ink-3"}`}>{label}</p>
      <p className="mt-1 text-[18px] font-extrabold tabular-nums">{value}</p>
    </div>
  );
}

function DecisionLine({ icon: Icon, label, value }: { icon: typeof DollarSign; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/10 text-white/75">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="flex-1 text-[12px] font-medium text-white/75">{label}</span>
      <span className="text-[13px] font-bold text-white">{value}</span>
    </div>
  );
}

function ActionPanel() {
  const { listing, modeledCeiling } = React.useContext(PublishedListingContext);
  const scoreN = Number(listing?.dealScore);
  const score = Number.isFinite(scoreN) && scoreN > 0 ? String(scoreN) : "—";
  const [actions, setActions] = React.useState([
    { label: "Order a title search", detail: "Find out which liens survive the sale", owner: "You", done: false },
    { label: "Check occupancy", detail: "Use what the listing says, or note that it is missing", owner: "You", done: false },
    { label: "Line up the deposit", detail: "Check the deposit the listing asks for", owner: "You", done: false },
  ]);

  const completedCount = actions.filter((a) => a.done).length;
  const toggleAction = (label: string) => {
    setActions((prev) =>
      prev.map((item) => (item.label === label ? { ...item, done: !item.done } : item))
    );
  };

  return (
    <div data-testid="storyteller-act" className="grid min-h-[480px] gap-5 lg:grid-cols-[1.05fr_0.95fr]">
      <article className="overflow-hidden rounded-[24px] border border-line bg-card shadow-sm">
        <div className="flex items-start justify-between gap-4 border-b border-line bg-ink px-6 py-5 text-white">
          <div>
            <p className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-white/75">Listing</p>
            <h4 className="mt-1 text-[21px] font-bold">{listing?.address || "No listing to show yet"}</h4>
            <p className="mt-0.5 text-[11px] font-medium text-white/60">Your shortlist card</p>
          </div>
          <span className="rounded-xl bg-white/10 px-3 py-2 text-[11px] font-extrabold text-white">
            {completedCount === actions.length ? "All done" : "To do"}
          </span>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-3 gap-2">
            <MemoMetric label="Deal Score" value={score} />
            <MemoMetric label="Opening" value={moneyText(listing?.openingBid)} />
            <MemoMetric label="Top bid" value={modeledCeiling !== null ? formatDollars(modeledCeiling) : "—"} />
          </div>
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-ink-3">Why it made the list</p>
              <ul className="mt-3 space-y-2">
                {[
                  listing?.saleDate ? `Sale date ${listing.saleDate}` : "No sale date listed",
                  listing?.source ? `Source ${listing.source}` : "No source listed",
                  listing?.parcelKey ? `Parcel ${listing.parcelKey}` : "No parcel number listed",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-[12px] font-semibold text-ink-2">
                    <CheckCircle2 className="h-4 w-4 text-ink-3" aria-hidden /> {item}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-ink-3">Conditions</p>
              <ul className="mt-3 space-y-2">
                {[
                  factText(listing?.occupancy) ? `Occupancy: ${factText(listing?.occupancy)}` : "Occupancy not listed",
                  factText(listing?.deposit) === null ? "Deposit not in the notice" : `Deposit ${factText(listing?.deposit)}`,
                  "Title still needs checking",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-[12px] font-semibold text-ink-2">
                    <AlertTriangle className="h-4 w-4 text-catch-ink" aria-hidden /> {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </article>

      <article className="rounded-[24px] border border-line bg-paper p-5 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-ink">Your to-do list</p>
            <h4 className="mt-1 text-[20px] font-bold text-ink">Before the sale date</h4>
          </div>
          <span className="rounded-full bg-card px-3 py-1.5 text-[10px] font-bold text-ink-3 shadow-sm">
            {completedCount} of {actions.length} done
          </span>
        </div>
        <div className="mt-5 space-y-2.5">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              role="checkbox"
              aria-checked={action.done}
              onClick={() => toggleAction(action.label)}
              className="flex w-full items-start gap-3 rounded-2xl border border-line bg-card p-4 text-left transition hover:border-line-strong"
            >
              <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${action.done ? "bg-go-wash text-go" : "border border-line-strong text-transparent"}`}>
                <CheckCircle2 className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-bold text-ink">{action.label}</span>
                <span className="mt-0.5 block text-[11px] font-medium text-ink-3">{action.detail}</span>
              </span>
              <span className="rounded-lg bg-line px-2 py-1 text-[9px] font-extrabold uppercase tracking-[0.06em] text-ink-3">{action.owner}</span>
            </button>
          ))}
        </div>
        <a href={listing?.id ? `/listings/${encodeURIComponent(listing.id)}` : "/listings"} className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-ink px-4 text-[12px] font-bold text-white">
          Browse listings <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </a>
      </article>
    </div>
  );
}

function MemoMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-paper px-3 py-4 text-center">
      <p className="text-[9px] font-extrabold uppercase tracking-[0.08em] text-ink-3">{label}</p>
      <p className="mt-1 text-[19px] font-extrabold tabular-nums text-ink">{value}</p>
    </div>
  );
}
