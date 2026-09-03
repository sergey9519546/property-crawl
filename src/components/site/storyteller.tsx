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
import { DealDiscoveryMap as OpportunityAtlas } from "./deal-discovery-map";
import { GsapReveal } from "./gsap-reveal";

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

const DEMO_DEAL = {
  address: "4120 Clark Ave",
  market: "Detroit–Shoreway · Cleveland, OH",
  opening: "$42k",
  score: "92",
};

export function Storyteller() {
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

  return (
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
          <p className="mx-auto mt-5 max-w-[650px] text-[16px] leading-[1.65] text-[#64748B] sm:text-[17px]">
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
                  {DEMO_DEAL.address}
                  <span className="ml-2 font-medium text-[#64748B]">{DEMO_DEAL.market}</span>
                </p>
              </div>
              <span className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] font-bold text-emerald-800">
                <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
                Real map · demo decision data
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
                      selected ? "text-[#111827]" : "text-[#64748B] hover:bg-[#F8FAFC]"
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
                            : "bg-[#F1F5F9] text-[#64748B] group-hover:bg-[#E2E8F0]"
                        }`}
                      >
                        {item.step}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[12px] font-extrabold tracking-[-0.01em] sm:text-[15px] sm:tracking-normal">
                          {item.label}
                        </span>
                        <span className="mt-0.5 block text-[10px] font-semibold leading-[1.3] text-[#64748B] sm:text-[11px]">
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
                  <p className="mt-1.5 max-w-[720px] text-[13px] font-medium leading-[1.55] text-[#64748B] sm:text-[14px]">
                    {activeStage.description}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <p className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-[#94A3B8]">
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
              <div className="hidden items-center gap-2 text-[11px] font-semibold text-[#64748B] sm:flex">
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
                    href="#live-feed"
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
  );
}

function ProductContent({ stage }: { stage: StageKey }) {
  if (stage === "find") return <OpportunityAtlas />;
  if (stage === "verify") return <VerificationPanel />;
  if (stage === "underwrite") return <UnderwritePanel />;
  return <ActionPanel />;
}

function VerificationPanel() {
  const checks = [
    {
      icon: Landmark,
      label: "County sale notice",
      detail: "Sale date and opening bid extracted from the demo filing.",
      status: "Matched",
      tone: "emerald",
    },
    {
      icon: Building2,
      label: "Parcel and owner record",
      detail: "Parcel identity, owner name, and mailing record resolve together.",
      status: "Matched",
      tone: "emerald",
    },
    {
      icon: Database,
      label: "Tax and property record",
      detail: "Tax status, use code, lot, and improvement record cross-checked.",
      status: "Matched",
      tone: "emerald",
    },
    {
      icon: Scale,
      label: "Debt position",
      detail: "Senior lien amount is not supplied in this demo source packet.",
      status: "Review",
      tone: "amber",
    },
  ];

  return (
    <div data-testid="storyteller-verify" className="grid min-h-[480px] gap-5 lg:grid-cols-[0.88fr_1.12fr]">
      <article className="relative overflow-hidden rounded-[24px] bg-[#0F172A] p-6 text-white shadow-[0_24px_60px_rgba(15,23,42,0.2)] sm:p-8">
        <div aria-hidden className="absolute -right-14 -top-14 h-56 w-56 rounded-full bg-slate-500/20 blur-3xl" />
        <p className="relative text-[10px] font-extrabold uppercase tracking-[0.16em] text-slate-300">
          Demo evidence packet
        </p>
        <h4 className="relative mt-3 text-[28px] font-bold tracking-[-0.03em]">{DEMO_DEAL.address}</h4>
        <p className="relative mt-1 text-[13px] font-medium text-slate-300">{DEMO_DEAL.market}</p>

        <dl className="relative mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-white/10">
          <EvidenceFact label="Source" value="County notice" />
          <EvidenceFact label="Case" value="CV-26-01482" />
          <EvidenceFact label="Sale date" value="Sep 08, 2026" />
          <EvidenceFact label="Deposit" value="$4,200" />
        </dl>

        <div className="relative mt-6 rounded-2xl border border-white/10 bg-white/[0.06] p-4">
          <div className="flex items-center gap-2 text-[11px] font-bold text-white">
            <FileText className="h-4 w-4 text-slate-300" aria-hidden /> Filing translated into plain English
          </div>
          <p className="mt-2 text-[12px] leading-[1.55] text-slate-300">
            Demo notice indicates a county sale in eight days with a {DEMO_DEAL.opening} opening bid.
            Title priority and occupancy remain diligence items before bidding.
          </p>
        </div>
      </article>

      <article className="rounded-[24px] border border-[#E2E8F0] bg-white p-5 shadow-sm sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#64748B]">Source-by-source check</p>
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
                <span className="mt-0.5 block text-[11px] font-medium leading-[1.45] text-[#64748B]">{check.detail}</span>
              </span>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[9px] font-extrabold uppercase tracking-[0.08em] ${
                check.tone === "emerald"
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-amber-50 text-amber-700"
              }`}>
                {check.status}
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
  const deductions = [
    { label: "Modeled ARV", value: "$95k", width: "100%", color: "bg-emerald-600" },
    { label: "Repairs", value: "−$18k", width: "78%", color: "bg-sky-500" },
    { label: "Carry + close", value: "−$7k", width: "60%", color: "bg-indigo-400" },
    { label: "Required profit", value: "−$22k", width: "46%", color: "bg-violet-400" },
  ];

  return (
    <div data-testid="storyteller-underwrite" className="grid min-h-[480px] gap-5 lg:grid-cols-[1.2fr_0.8fr]">
      <article className="rounded-[24px] border border-[#E2E8F0] bg-white p-6 shadow-sm sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-900">Demo assumptions</p>
            <h4 className="mt-1 text-[22px] font-bold tracking-[-0.02em] text-[#111827]">Build the walk-away number</h4>
            <p className="mt-1 text-[12px] font-medium text-[#64748B]">Every estimate stays visible, editable, and attributable.</p>
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
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-[#EEF2F7]">
                <div className={`h-full rounded-full ${item.color}`} style={{ width: item.width }} />
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 grid grid-cols-3 gap-2 rounded-2xl bg-[#F8FAFC] p-2">
          <ModelStat label="Opening bid" value="$42k" />
          <ModelStat label="Bid ceiling" value="$48k" emphasis />
          <ModelStat label="Offer room" value="$6k" />
        </div>
      </article>

      <article className="flex flex-col rounded-[24px] bg-[#0F172A] p-6 text-white shadow-[0_24px_60px_rgba(15,23,42,0.2)] sm:p-8">
        <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-slate-300">Decision</p>
        <p className="mt-3 text-[13px] font-semibold text-slate-300">Modeled bid range</p>
        <p className="mt-1 text-[42px] font-bold tracking-[-0.04em] text-white">$42k–$46k</p>
        <div className="mt-5 h-px bg-white/10" />
        <div className="mt-5 space-y-4">
          <DecisionLine icon={DollarSign} label="Walk away above" value="$48k" />
          <DecisionLine icon={AlertTriangle} label="Risk reserve" value="$4k" />
          <DecisionLine icon={Calendar} label="Decision window" value="8 days" />
        </div>
        <div className="mt-auto rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4">
          <p className="text-[11px] font-bold text-amber-200">The catch</p>
          <p className="mt-1 text-[11px] leading-[1.5] text-slate-300">
            Occupancy and senior lien priority are unresolved in this demo packet. Resolve both before funding the deposit.
          </p>
        </div>
      </article>
    </div>
  );
}

function ModelStat({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className={`rounded-xl px-3 py-4 text-center ${emphasis ? "bg-[#0F172A] text-white" : "bg-white text-[#111827]"}`}>
      <p className={`text-[9px] font-extrabold uppercase tracking-[0.08em] ${emphasis ? "text-slate-400" : "text-[#94A3B8]"}`}>{label}</p>
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
  const actions = [
    { label: "Order title review", detail: "Confirm lien priority and exceptions", owner: "Legal", done: false },
    { label: "Complete drive-by", detail: "Validate occupancy and exterior condition", owner: "Acquisitions", done: true },
    { label: "Stage deposit funds", detail: "$4,200 due at winning bid", owner: "Capital", done: false },
  ];

  return (
    <div data-testid="storyteller-act" className="grid min-h-[480px] gap-5 lg:grid-cols-[1.05fr_0.95fr]">
      <article className="overflow-hidden rounded-[24px] border border-[#E2E8F0] bg-white shadow-sm">
        <div className="flex items-start justify-between gap-4 border-b border-[#E8EDF3] bg-[#0F172A] px-6 py-5 text-white">
          <div>
            <p className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-slate-300">Decision memo · demo</p>
            <h4 className="mt-1 text-[21px] font-bold">{DEMO_DEAL.address}</h4>
            <p className="mt-0.5 text-[11px] font-medium text-slate-400">Prepared for acquisition review</p>
          </div>
          <span className="rounded-xl bg-emerald-400/15 px-3 py-2 text-[11px] font-extrabold text-emerald-200">Advance with conditions</span>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-3 gap-2">
            <MemoMetric label="Deal score" value={DEMO_DEAL.score} />
            <MemoMetric label="Opening" value={DEMO_DEAL.opening} />
            <MemoMetric label="Bid ceiling" value="$48k" />
          </div>
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#64748B]">Why it advances</p>
              <ul className="mt-3 space-y-2">
                {["$53k gross value spread", "Three source matches", "Eight-day decision window"].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-[12px] font-semibold text-[#334155]">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden /> {item}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#64748B]">Conditions</p>
              <ul className="mt-3 space-y-2">
                {["Clear senior lien position", "Confirm occupancy", "Hold $4k risk reserve"].map((item) => (
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
          <span className="rounded-full bg-white px-3 py-1.5 text-[10px] font-bold text-[#64748B] shadow-sm">1 of 3 done</span>
        </div>
        <div className="mt-5 space-y-2.5">
          {actions.map((action) => (
            <div key={action.label} className="flex items-start gap-3 rounded-2xl border border-[#E2E8F0] bg-white p-4">
              <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${action.done ? "bg-emerald-100 text-emerald-700" : "border border-[#CBD5E1] text-transparent"}`}>
                <CheckCircle2 className="h-4 w-4" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-bold text-[#111827]">{action.label}</span>
                <span className="mt-0.5 block text-[11px] font-medium text-[#64748B]">{action.detail}</span>
              </span>
              <span className="rounded-lg bg-[#F1F5F9] px-2 py-1 text-[9px] font-extrabold uppercase tracking-[0.06em] text-[#64748B]">{action.owner}</span>
            </div>
          ))}
        </div>
        <a href="#live-feed" className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#0F172A] px-4 text-[12px] font-bold text-white">
          Open opportunity workspace <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </a>
      </article>
    </div>
  );
}

function MemoMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-[#F1F5F9] px-3 py-4 text-center">
      <p className="text-[9px] font-extrabold uppercase tracking-[0.08em] text-[#94A3B8]">{label}</p>
      <p className="mt-1 text-[19px] font-extrabold tabular-nums text-[#111827]">{value}</p>
    </div>
  );
}
