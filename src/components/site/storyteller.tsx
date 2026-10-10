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
import { GsapReveal } from "./gsap-reveal";

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
    summary: "Rank live signals",
    eyebrow: "Market scan",
    headline: "See where the opening is.",
    description:
      "Start with a real market, then inspect the opportunities that deserve attention first.",
    output: "Ranked opportunity list",
    icon: Search,
  },
  {
    key: "verify",
    step: "02",
    label: "Verify",
    summary: "Trace the evidence",
    eyebrow: "Evidence check",
    headline: "Know what posted—and what it means.",
    description:
      "Connect the signal to its source, extract the filing, and surface the facts that still need review.",
    output: "Source-backed evidence packet",
    icon: ShieldCheck,
  },
  {
    key: "underwrite",
    step: "03",
    label: "Underwrite",
    summary: "Set the bid ceiling",
    eyebrow: "Bid guardrail",
    headline: "See the ceiling and the catch.",
    description:
      "Pressure-test value, costs, required profit, and risk before the deposit becomes real.",
    output: "Risk-adjusted bid range",
    icon: Calculator,
  },
  {
    key: "act",
    step: "04",
    label: "Act",
    summary: "Leave with a next move",
    eyebrow: "Execution plan",
    headline: "Turn conviction into a deadline-driven plan.",
    description:
      "Carry only the winner forward with the evidence, deadlines, and next actions visible to the team.",
    output: "Decision-ready shortlist",
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
};

const PublishedListingContext = React.createContext<PublishedState>({
  listing: null,
  status: "loading",
});

function moneyText(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return "Not published";
  return `$${Math.round(n).toLocaleString()}`;
}

function useLoadPublishedListing(): PublishedState {
  const [state, setState] = React.useState<PublishedState>({ listing: null, status: "loading" });
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
    || (published.status === "loading" ? "Reading the listing feed" : published.status === "error" ? "Listing feed unavailable" : "No listing returned");
  const place = [published.listing?.city, published.listing?.state].filter(Boolean).join(", ");

  return (
    <PublishedListingContext.Provider value={published}>
    <section id="product" className="relative isolate overflow-hidden py-24 sm:py-28">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-20 -z-10 h-[620px] w-[min(1320px,96vw)] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(59,130,246,0.2),rgba(147,197,253,0.08)_46%,transparent_73%)] blur-3xl"
      />

      <div className="mx-auto max-w-[1280px] px-5 lg:px-8">
        <GsapReveal className="mx-auto max-w-[820px] text-center">
          <p className="text-[12px] font-extrabold uppercase tracking-[0.16em] text-slate-900">
            One property. Four decisions.
          </p>
          <h2 className="mt-4 text-[36px] font-semibold leading-[1.12] tracking-[-0.025em] text-[#111827] sm:text-[48px]">
            A lead is not a deal until it survives all four.
          </h2>
          <p className="mx-auto mt-5 max-w-[650px] text-[16px] leading-[1.65] text-[#5B6472] sm:text-[17px]">
            Find the signal, verify the filing, pressure-test the spread, and leave
            with a next move your team can defend.
          </p>
        </GsapReveal>

        <div className="mt-14 overflow-hidden rounded-[28px] border border-white/90 bg-white/88 shadow-[0_30px_100px_rgba(15,23,42,0.14)] backdrop-blur-xl">
            <div className="flex flex-col gap-3 border-b border-[#E8EDF3] bg-white/90 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-slate-900">
                  Property decision workflow
                </p>
                <p className="mt-1 text-[16px] font-semibold text-[#111827]">
                  {headline}
                  {place ? <span className="ml-2 font-medium text-[#5B6472]">{place}</span> : null}
                </p>
              </div>
              <span className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] font-bold text-emerald-800">
                <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
                {published.status === "ready" ? "Published listing" : headline}
              </span>
            </div>

            <div
              role="tablist"
              aria-label="Property decision workflow"
              className="relative grid grid-cols-2 gap-px border-b border-[#E8EDF3] bg-[#E8EDF3] sm:grid-cols-4"
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
                    className={`group relative min-h-[82px] bg-white px-3 py-4 text-left transition-colors sm:min-h-[94px] sm:px-5 ${
                      selected ? "text-[#111827]" : "text-[#5B6472] hover:bg-[#F8FAFC]"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`absolute inset-x-0 top-0 h-[3px] transition-colors ${
                        selected ? "bg-[#0F172A]" : "bg-transparent"
                      }`}
                    />
                    <span className="flex items-start gap-2 sm:gap-3">
                      <span
                        className={`grid h-8 w-8 shrink-0 place-items-center rounded-[10px] text-[10px] font-extrabold transition-colors sm:h-9 sm:w-9 sm:rounded-xl sm:text-[11px] ${
                          selected
                            ? "bg-[#0F172A] text-white"
                            // #64748b on #F1F5F9 measured 4.34:1 against a 4.5:1
                            // requirement - the step number was flagged as
                            // insufficient contrast. #475569 lands near 6.3:1 and
                            // still reads as clearly unselected.
                            : "bg-[#F1F5F9] text-[#475569] group-hover:bg-[#E2E8F0]"
                        }`}
                      >
                        {item.step}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[12px] font-extrabold tracking-[-0.01em] sm:text-[15px] sm:tracking-normal">
                          {item.label}
                        </span>
                        <span className="mt-0.5 block text-[10px] font-semibold leading-[1.3] text-[#5B6472] sm:text-[11px]">
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
              <div className="grid gap-4 border-b border-[#E8EDF3] bg-[#F8FAFC] px-5 py-5 sm:grid-cols-[1fr_auto] sm:items-center sm:px-7">
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-900">
                    {activeStage.step} · {activeStage.eyebrow}
                  </p>
                  <h3 className="mt-1 text-[23px] font-bold tracking-[-0.02em] text-[#111827]">
                    {activeStage.headline}
                  </h3>
                  <p className="mt-1.5 max-w-[720px] text-[13px] font-medium leading-[1.55] text-[#5B6472] sm:text-[14px]">
                    {activeStage.description}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <p className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-[#5B6472]">
                    Output
                  </p>
                  <p className="mt-1 text-[13px] font-bold text-[#0F172A]">
                    {activeStage.output}
                  </p>
                </div>
              </div>

              <div className={stage === "find" ? "p-3 sm:p-5" : "p-5 sm:p-7"}>
                <ProductContent stage={stage} />
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-[#E8EDF3] bg-white px-5 py-4 sm:px-7">
              <div className="hidden items-center gap-2 text-[11px] font-semibold text-[#5B6472] sm:flex">
                <span className="text-[#0F172A]">{activeIndex + 1} of {STAGES.length}</span>
                <span aria-hidden>·</span>
                <span>Keep the same opportunity in view</span>
              </div>
              <div className="ml-auto flex items-center gap-2">
                {activeIndex > 0 ? (
                  <button
                    type="button"
                    onClick={() => setStage(STAGES[activeIndex - 1].key)}
                    className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-[#DCE3EA] bg-white px-4 text-[12px] font-bold text-[#334155] hover:bg-[#F8FAFC]"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" aria-hidden /> Back
                  </button>
                ) : null}
                {activeIndex < STAGES.length - 1 ? (
                  <button
                    type="button"
                    onClick={() => setStage(STAGES[activeIndex + 1].key)}
                    className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#0F172A] px-4 text-[12px] font-bold text-white hover:bg-[#1E293B]"
                  >
                    Next: {STAGES[activeIndex + 1].label}
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  </button>
                ) : (
                  <a
                    href="/listings"
                    className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#0F172A] px-4 text-[12px] font-bold text-white hover:bg-[#1E293B]"
                  >
                    Open live workspace <ArrowRight className="h-3.5 w-3.5" aria-hidden />
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
    { icon: Building2, label: "Parcel key", detail: listing?.parcelKey || "Not published" },
    { icon: Database, label: "Sale date", detail: listing?.saleDate || "Not published" },
    { icon: Scale, label: "Occupancy", detail: listing?.occupancy || "Not published" },
  ];

  return (
    <div data-testid="storyteller-verify" className="grid min-h-[480px] gap-5 lg:grid-cols-[0.88fr_1.12fr]">
      <article className="relative overflow-hidden rounded-[24px] bg-[#0F172A] p-6 text-white shadow-[0_24px_60px_rgba(15,23,42,0.2)] sm:p-8">
        <div aria-hidden className="absolute -right-14 -top-14 h-56 w-56 rounded-full bg-slate-500/20 blur-3xl" />
        <p className="relative text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-300">
          Published listing
        </p>
        <h4 className="relative mt-3 text-[28px] font-bold tracking-[-0.03em]">{listing?.address || (status === "loading" ? "Reading the listing feed" : "No listing returned")}</h4>
        <p className="relative mt-1 text-[13px] font-medium text-slate-300">{[listing?.county, listing?.state].filter(Boolean).join(", ") || listing?.source || "Fields below are the record"}</p>

        <dl className="relative mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-white/10">
          <EvidenceFact label="Source" value={listing?.source || "Not published"} />
          <EvidenceFact label="Opening" value={moneyText(listing?.openingBid)} />
          <EvidenceFact label="Sale date" value={listing?.saleDate || "Not published"} />
          <EvidenceFact label="Deposit" value={moneyText(listing?.deposit)} />
        </dl>

        <div className="relative mt-6 rounded-2xl border border-white/10 bg-white/[0.06] p-4">
          <div className="flex items-center gap-2 text-[11px] font-bold text-white">
            <FileText className="h-4 w-4 text-slate-300" aria-hidden /> Record fields
          </div>
          <p className="mt-2 text-[12px] leading-[1.55] text-slate-300">
            {listing?.id ? "These values are the fields on the loaded listing." : "The feed did not return a listing to read."}
          </p>
        </div>
      </article>

      <article className="rounded-[24px] border border-[#E2E8F0] bg-white p-5 shadow-sm sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#5B6472]">Source-by-source check</p>
            <h4 className="mt-1 text-[20px] font-bold text-[#111827]">What is known—and what is not</h4>
          </div>
          <ShieldCheck className="h-7 w-7 text-emerald-600" aria-hidden />
        </div>
        <div className="mt-5 space-y-2.5">
          {checks.map((check) => (
            <div key={check.label} className="flex items-start gap-3 rounded-2xl border border-[#E8EDF3] bg-[#F8FAFC] p-4">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-[#334155] shadow-sm">
                <check.icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-bold text-[#111827]">{check.label}</span>
                <span className="mt-0.5 block text-[11px] font-medium leading-[1.45] text-[#5B6472]">{check.detail}</span>
              </span>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-[0.08em] ${
                check.detail === "Not published"
                  ? "bg-amber-50 text-amber-700"
                  : "bg-emerald-50 text-emerald-700"
              }`}>
                {check.detail === "Not published" ? "Not published" : "Published"}
              </span>
            </div>
          ))}
        </div>
      </article>
    </div>
  );
}

function EvidenceFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white/[0.06] p-4">
      <dt className="text-[9px] font-extrabold uppercase tracking-[0.12em] text-slate-400">{label}</dt>
      <dd className="mt-1 text-[13px] font-bold text-white">{value}</dd>
    </div>
  );
}

function UnderwritePanel() {
  const { listing } = React.useContext(PublishedListingContext);
  const openingN = Number(listing?.openingBid);
  const opening = Number.isFinite(openingN) && openingN > 0 ? openingN : null;
  const [assumed, setAssumed] = React.useState(0);
  const [repairs, setRepairs] = React.useState(0);
  const [carry, setCarry] = React.useState(0);
  const [profit, setProfit] = React.useState(0);
  const ceiling = assumed > 0 ? Math.max(0, assumed - repairs - carry - profit) : null;
  const offerRoom = ceiling !== null && opening !== null ? Math.max(0, ceiling - opening) : null;
  const dollars = (n: number) => `$${Math.round(n).toLocaleString()}`;
  const bar = (amount: number) => (assumed > 0 ? `${Math.max(0, Math.min(100, Math.round((amount / assumed) * 100)))}%` : "0%");

  const deductions = [
    {
      label: "Assumed value",
      value: assumed > 0 ? dollars(assumed) : "Not entered",
      width: "100%",
      color: "bg-emerald-600",
      min: 0,
      max: 500000,
      current: assumed,
      onChange: setAssumed as ((v: number) => void) | undefined,
    },
    {
      label: "Repairs",
      value: dollars(repairs),
      width: bar(Math.max(0, assumed - repairs)),
      color: "bg-sky-500",
      min: 0,
      max: 200000,
      current: repairs,
      onChange: setRepairs,
    },
    {
      label: "Carry + close",
      value: dollars(carry),
      width: bar(Math.max(0, assumed - repairs - carry)),
      color: "bg-indigo-400",
      min: 0,
      max: 100000,
      current: carry,
      onChange: setCarry,
    },
    {
      label: "Required profit",
      value: dollars(profit),
      width: bar(ceiling ?? 0),
      color: "bg-violet-400",
      min: 0,
      max: 200000,
      current: profit,
      onChange: setProfit,
    },
  ];

  return (
    <div data-testid="storyteller-underwrite" className="grid min-h-[480px] gap-5 lg:grid-cols-[1.2fr_0.8fr]">
      <article className="rounded-[24px] border border-[#E2E8F0] bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-900">Operator assumptions</p>
            <h4 className="mt-1 text-[22px] font-bold tracking-[-0.02em] text-[#111827]">Build the walk-away number</h4>
            <p className="mt-1 text-[12px] font-medium text-[#5B6472]">Every estimate stays visible, editable, and attributable.</p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-2 text-[11px] font-bold text-slate-900">
            <Calculator className="h-4 w-4" aria-hidden /> Conservative model
          </span>
        </div>

        <div className="mt-7 space-y-4" aria-label="Modeled value deductions">
          {deductions.map((item) => (
            <div key={item.label}>
              <div className="flex items-center justify-between text-[12px] font-bold">
                <span className="text-[#475569]">{item.label}</span>
                <span className="tabular-nums text-[#111827]">{item.value}</span>
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
                  className="mt-2 h-2.5 w-full cursor-pointer accent-slate-900"
                />
              ) : (
                <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-[#EEF2F7]">
                  <div className={`h-full rounded-full ${item.color}`} style={{ width: item.width }} />
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="mt-8 grid grid-cols-3 gap-2 rounded-2xl bg-[#F8FAFC] p-2">
          <ModelStat label="Opening bid" value={opening === null ? "Not published" : dollars(opening)} />
          <ModelStat label="Bid ceiling" value={ceiling === null ? "—" : dollars(ceiling)} emphasis />
          <ModelStat label="Offer room" value={offerRoom === null ? "—" : dollars(offerRoom)} />
        </div>
      </article>

      <article className="flex flex-col rounded-[24px] bg-[#0F172A] p-6 text-white shadow-[0_24px_60px_rgba(15,23,42,0.2)] sm:p-8">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-300">Decision</p>
        <p className="mt-3 text-[13px] font-semibold text-slate-300">Modeled bid range</p>
        <p className="mt-1 text-[42px] font-bold tracking-[-0.04em] text-white">{ceiling === null ? "—" : dollars(ceiling)}</p>
        <div className="mt-5 h-px bg-white/10" />
        <div className="mt-5 space-y-4">
          <DecisionLine icon={DollarSign} label="Walk away above" value={ceiling === null ? "—" : dollars(ceiling)} />
          <DecisionLine icon={AlertTriangle} label="Published deposit" value={moneyText(listing?.deposit)} />
          <DecisionLine icon={Calendar} label="Sale date" value={listing?.saleDate || "Not published"} />
        </div>
        <div className="mt-auto rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4">
          <p className="text-[11px] font-bold text-amber-200">Occupancy</p>
          <p className="mt-1 text-[11px] leading-[1.5] text-slate-300">
            {listing?.occupancy ? `Published occupancy: ${listing.occupancy}.` : "Occupancy is not published on this listing."}
          </p>
        </div>
      </article>
    </div>
  );
}

function ModelStat({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className={`rounded-xl px-3 py-4 text-center ${emphasis ? "bg-[#0F172A] text-white" : "bg-white text-[#111827]"}`}>
      <p className={`text-[9px] font-extrabold uppercase tracking-[0.08em] ${emphasis ? "text-slate-400" : "text-[#5B6472]"}`}>{label}</p>
      <p className="mt-1 text-[18px] font-extrabold tabular-nums">{value}</p>
    </div>
  );
}

function DecisionLine({ icon: Icon, label, value }: { icon: typeof DollarSign; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/10 text-slate-300">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="flex-1 text-[12px] font-medium text-slate-300">{label}</span>
      <span className="text-[13px] font-bold text-white">{value}</span>
    </div>
  );
}

function ActionPanel() {
  const { listing } = React.useContext(PublishedListingContext);
  const scoreN = Number(listing?.dealScore);
  const score = Number.isFinite(scoreN) && scoreN > 0 ? String(scoreN) : "—";
  const [actions, setActions] = React.useState([
    { label: "Order title review", detail: "Confirm lien priority and exceptions", owner: "Legal", done: false },
    { label: "Check occupancy", detail: "Use the published occupancy field, or record that it is missing", owner: "Acquisitions", done: false },
    { label: "Stage deposit funds", detail: "Use the published deposit on the listing", owner: "Capital", done: false },
  ]);

  const completedCount = actions.filter((a) => a.done).length;
  const toggleAction = (label: string) => {
    setActions((prev) =>
      prev.map((item) => (item.label === label ? { ...item, done: !item.done } : item))
    );
  };

  return (
    <div data-testid="storyteller-act" className="grid min-h-[480px] gap-5 lg:grid-cols-[1.05fr_0.95fr]">
      <article className="overflow-hidden rounded-[24px] border border-[#E2E8F0] bg-white shadow-sm">
        <div className="flex items-start justify-between gap-4 border-b border-[#E8EDF3] bg-[#0F172A] px-6 py-5 text-white">
          <div>
            <p className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-slate-300">Listing record</p>
            <h4 className="mt-1 text-[21px] font-bold">{listing?.address || "No listing loaded"}</h4>
            <p className="mt-0.5 text-[11px] font-medium text-slate-400">Prepared for acquisition review</p>
          </div>
          <span className="rounded-xl bg-emerald-400/15 px-3 py-2 text-[11px] font-extrabold text-emerald-200">
            {completedCount === actions.length ? "Checklist complete" : "Checklist open"}
          </span>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-3 gap-2">
            <MemoMetric label="Deal score" value={score} />
            <MemoMetric label="Opening" value={moneyText(listing?.openingBid)} />
            <MemoMetric label="Bid ceiling" value="—" />
          </div>
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#5B6472]">Why it advances</p>
              <ul className="mt-3 space-y-2">
                {[
                  listing?.saleDate ? `Sale date ${listing.saleDate}` : "Sale date is not published",
                  listing?.source ? `Source ${listing.source}` : "Source is not published",
                  listing?.parcelKey ? `Parcel ${listing.parcelKey}` : "Parcel key is not published",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-[12px] font-semibold text-[#334155]">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden /> {item}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#5B6472]">Conditions</p>
              <ul className="mt-3 space-y-2">
                {[
                  listing?.occupancy ? `Occupancy: ${listing.occupancy}` : "Occupancy is not published",
                  moneyText(listing?.deposit) === "Not published" ? "Deposit is not published" : `Deposit ${moneyText(listing?.deposit)}`,
                  "Title priority is not decided on this page",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-[12px] font-semibold text-[#334155]">
                    <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden /> {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </article>

      <article className="rounded-[24px] border border-[#E2E8F0] bg-[#F8FAFC] p-5 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-900">Next-action board</p>
            <h4 className="mt-1 text-[20px] font-bold text-[#111827]">Move before the deadline</h4>
          </div>
          <span className="rounded-full bg-white px-3 py-1.5 text-[10px] font-bold text-[#5B6472] shadow-sm">
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
              className="flex w-full items-start gap-3 rounded-2xl border border-[#E2E8F0] bg-white p-4 text-left transition hover:border-slate-300"
            >
              <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${action.done ? "bg-emerald-100 text-emerald-700" : "border border-[#CBD5E1] text-transparent"}`}>
                <CheckCircle2 className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-bold text-[#111827]">{action.label}</span>
                <span className="mt-0.5 block text-[11px] font-medium text-[#5B6472]">{action.detail}</span>
              </span>
              <span className="rounded-lg bg-[#F1F5F9] px-2 py-1 text-[9px] font-extrabold uppercase tracking-[0.06em] text-[#5B6472]">{action.owner}</span>
            </button>
          ))}
        </div>
        <a href={listing?.id ? `/listings/${encodeURIComponent(listing.id)}` : "/listings"} className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#0F172A] px-4 text-[12px] font-bold text-white">
          Open opportunity workspace <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </a>
      </article>
    </div>
  );
}

function MemoMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-[#F1F5F9] px-3 py-4 text-center">
      <p className="text-[9px] font-extrabold uppercase tracking-[0.08em] text-[#5B6472]">{label}</p>
      <p className="mt-1 text-[19px] font-extrabold tabular-nums text-[#111827]">{value}</p>
    </div>
  );
}
