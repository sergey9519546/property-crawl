"use client";

import * as React from "react";
import Link from "next/link";
import { GsapReveal } from "./gsap-reveal";
import {
  Palette,
  FileStack,
  Sparkles,
  SlidersHorizontal,
  Share2,
  MapPin,
  TrendingUp,
  FileText,
  Download,
  type LucideIcon,
} from "lucide-react";

type Step = {
  label: string;
  title: string;
  desc: string;
  href: string;
  icon: LucideIcon;
  visual: React.ReactNode;
};

const STEPS: Step[] = [
  {
    label: "Ingest",
    title: "Ingest the notice",
    desc: "When AI parse is configured, legal prose maps to structured fields. Without it, you still get the source notice and listing facts — nothing is invented.",
    href: "/listings",
    icon: Palette,
    visual: <DealKitVisual />,
  },
  {
    label: "Score",
    title: "Score the county figure",
    desc: "Deal Score is the published opening amount divided by a county assessor figure, and only where the market conversion is confirmed. Every other county shows the raw figure or nothing, and the score stays blank.",
    href: "/listings",
    icon: FileStack,
    visual: <ParcelContextVisual />,
  },
  {
    label: "Explain",
    title: "Read the catch",
    desc: "Each listing runs the published plaintiff through the state statute table and prints the warnings next to occupancy and deposit terms when those were published. That check is not a title opinion.",
    href: "/listings",
    icon: Sparkles,
    visual: <PromptVisual />,
  },
  {
    label: "Watch",
    title: "Save the listing",
    desc: "The watchlist toggle is on the listing. The home underwrite sliders start at zero and use only amounts you enter.",
    href: "/listings",
    icon: SlidersHorizontal,
    visual: <FineTuneVisual />,
  },
  {
    label: "Export",
    title: "Export the record",
    desc: "The feed exports CSV or JSON after operator sign-in. A decision packet is on each listing. Partner PDFs are not built.",
    href: "/listings",
    icon: Share2,
    visual: <DownloadVisual />,
  },
];

export function FastestWay() {
  const first = STEPS[0];
  const rest = STEPS.slice(1);
  return (
    <section className="pt-24 pb-28 sm:pt-24 sm:pb-28">
      <div className="mx-auto max-w-[1080px] px-5 lg:px-8">
        {/* Bento layout: 3 rows × 2-col grid, gap 16px */}
        <div className="flex flex-col gap-4">
          {/* Row 1: heading + first card */}
          <div className="grid grid-cols-2 items-center gap-4">
            <GsapReveal>
              <div className="flex flex-col justify-center">
                <h2 className="text-[26px] font-medium leading-[1.17] tracking-[-0.015em] text-[#111827] sm:text-[32px] lg:text-[36px]">
                  From posted notice to bid, in one afternoon.
                </h2>
                <p className="mt-4 max-w-[420px] text-[16px] leading-[1.6] text-[#5B6472] sm:text-[18px]">
                  Federal auctions update by the hour. County sheriffs post on
                  Tuesdays. The loop that ships is the notice, the county figure,
                  the statute check, the watchlist, and the export.
                </p>
              </div>
            </GsapReveal>
            <BentoCard step={first} delay={0.1} />
          </div>
          {/* Row 2 */}
          <div className="grid grid-cols-2 gap-4">
            <BentoCard step={rest[0]} delay={0.2} />
            <BentoCard step={rest[1]} delay={0.3} />
          </div>
          {/* Row 3 */}
          <div className="grid grid-cols-2 gap-4">
            <BentoCard step={rest[2]} delay={0.4} />
            <BentoCard step={rest[3]} delay={0.5} />
          </div>
        </div>
      </div>
    </section>
  );
}

function BentoCard({ step, delay }: { step: Step; delay: number }) {
  return (
    <GsapReveal delay={delay}>
      <article
        className="flex h-full min-h-[480px] flex-col overflow-hidden rounded-2xl transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:shadow-[0_1px_2px_rgba(17,24,39,0.05),0_12px_32px_rgba(17,24,39,0.08)]"
        style={{ backgroundColor: "#FFFFFF" }}
      >
        {/* Media-first visual demonstration (top ~60% of card) */}
        <div className="relative flex h-[280px] items-center justify-center overflow-hidden border-b border-[#E5E7EB] bg-white p-6">
          {step.visual}
        </div>
        {/* Text content (bottom ~40%) */}
        <div className="flex flex-1 flex-col gap-2 p-6">
          <div className="flex items-center gap-2">
            <step.icon className="h-4 w-4 text-[#5B6472]" />
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#5B6472]">
              {step.label}
            </p>
          </div>
          <h3 className="text-[18px] font-semibold tracking-[-0.01em] text-[#111827]">
            <Link href={step.href} className="hover:underline">{step.title}</Link>
          </h3>
          <p className="mt-1 text-[14px] leading-[1.6] text-[#5B6472]">
            {step.desc}
          </p>
        </div>
      </article>
    </GsapReveal>
  );
}

// Visual demonstrations — media-first product UI mockups

function DealKitVisual() {
  return (
    <div className="w-full max-w-[280px] rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 border-b border-[#F3F4F6] pb-2">
        <Palette className="h-4 w-4 text-[#0F172A]" />
        <span className="text-[12px] font-semibold text-[#111827]">Deal Kit</span>
        <span className="ml-auto rounded-full bg-[#e7faef] px-2 py-0.5 text-[11px] font-bold text-[#15803D]">Active</span>
      </div>
      <div className="mt-3 space-y-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-[#5B6472]">County figure</span>
          <span className="font-mono text-[#111827]">assessor field</span>
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-[#5B6472]">Ratio</span>
          <span className="font-mono text-[#111827]">bid ÷ figure</span>
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-[#5B6472]">Record</span>
          <span className="font-medium text-[#111827]">listing page</span>
        </div>
      </div>
    </div>
  );
}

function ParcelContextVisual() {
  return (
    <div className="grid w-full max-w-[300px] grid-cols-2 gap-2">
      <div className="col-span-2 flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white p-2.5">
        <MapPin className="h-4 w-4 text-[#0F172A]" />
        <span className="text-[12px] font-semibold text-[#111827]">Listing address</span>
        <span className="ml-auto text-[11px] text-[#5B6472]">from the record</span>
      </div>
      <div className="rounded-lg border border-[#E5E7EB] bg-white p-2.5">
        <p className="text-[11px] font-semibold uppercase text-[#5B6472]">Assessor</p>
        <p className="mt-1 text-[11px] text-[#111827]">county figure</p>
      </div>
      <div className="rounded-lg border border-[#E5E7EB] bg-white p-2.5">
        <p className="text-[11px] font-semibold uppercase text-[#5B6472]">Distress</p>
        <p className="mt-1 text-[11px] text-[#111827]">only if published</p>
      </div>
      <div className="col-span-2 rounded-lg border border-[#E5E7EB] bg-white p-2.5">
        <p className="text-[11px] font-semibold uppercase text-[#5B6472]">Photos</p>
        <div className="mt-1.5 flex gap-1">
          {[0,1,2,3].map(i => <div key={i} className="h-8 flex-1 rounded bg-[#F3F4F6]" />)}
        </div>
      </div>
    </div>
  );
}

function PromptVisual() {
  return (
    <div className="w-full max-w-[300px] space-y-2">
      <div className="flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white p-2.5">
        <Sparkles className="h-4 w-4 text-[#0F172A]" />
        <span className="text-[12px] text-[#5B6472]">Rules check on the listing</span>
      </div>
      <Link href="/listings" className="block rounded-lg border border-[#0F172A] bg-[#0F172A]/5 p-3 text-[11px] font-semibold text-[#0F172A] hover:bg-[#0F172A]/10">
        Open the rules check on a listing
      </Link>
      <div className="flex items-center gap-2 rounded-lg border border-[#e7faef] bg-[#e7faef]/50 p-2.5">
        <TrendingUp className="h-4 w-4 text-[#15803D]" />
        <span className="text-[11px] font-semibold text-[#15803D]">Score withheld without a county figure</span>
      </div>
    </div>
  );
}

function FineTuneVisual() {
  return (
    <div className="w-full max-w-[280px] rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 border-b border-[#F3F4F6] pb-2">
        <SlidersHorizontal className="h-4 w-4 text-[#111827]" />
        <span className="text-[12px] font-semibold text-[#111827]">Underwrite Editor</span>
      </div>
      <div className="mt-3 space-y-3">
        <SliderRow label="Opening" value="—" pct={0} />
        <SliderRow label="Figure" value="—" pct={0} />
        <SliderRow label="Score" value="—" pct={0} />
      </div>
    </div>
  );
}

function SliderRow({ label, value, pct, accent }: { label: string; value: string; pct: number; accent?: boolean }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-[#5B6472]">{label}</span>
        <span className={`font-bold ${accent ? "text-[#15803D]" : "text-[#111827]"}`}>{value}</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[#F3F4F6]">
        <div className={`h-full rounded-full ${accent ? "bg-[#3aaf57]" : "bg-[#0F172A]"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function DownloadVisual() {
  return (
    <div className="grid w-full max-w-[280px] grid-cols-2 gap-2">
      <div className="col-span-2 flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white p-2.5">
        <FileText className="h-4 w-4 text-[#0F172A]" />
        <span className="text-[12px] font-semibold text-[#111827]">Decision packet</span>
      </div>
      <Link href="/listings" className="flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white p-2.5 hover:bg-[#F5F6F7]">
        <Download className="h-3.5 w-3.5 text-[#5B6472]" />
        <span className="text-[11px] font-medium text-[#111827]">CSV from the feed</span>
      </Link>
      <Link href="/listings" className="flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white p-2.5 hover:bg-[#F5F6F7]">
        <FileText className="h-3.5 w-3.5 text-[#5B6472]" />
        <span className="text-[11px] font-medium text-[#111827]">JSON from the feed</span>
      </Link>
    </div>
  );
}
