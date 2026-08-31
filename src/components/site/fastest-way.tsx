"use client";

import * as React from "react";
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
  Link2,
  type LucideIcon,
} from "lucide-react";

type Step = {
  label: string;
  title: string;
  desc: string;
  icon: LucideIcon;
  visual: React.ReactNode;
};

const STEPS: Step[] = [
  {
    label: "Ingest",
    title: "Ingest the notice",
    desc: "AI parses the legal prose — plaintiff, judgment, sale date, deposit terms — into structured fields.",
    icon: Palette,
    visual: <DealKitVisual />,
  },
  {
    label: "Score",
    title: "Score against comps",
    desc: "Opening bid ÷ estimated value band. The Deal Score. Below 50 means the bid is half the value.",
    icon: FileStack,
    visual: <ParcelContextVisual />,
  },
  {
    label: "Explain",
    title: "Read the catch",
    desc: "AI writes a one-paragraph risk note — occupied vs. vacant, redemption period, certified funds, redemption risk.",
    icon: Sparkles,
    visual: <PromptVisual />,
  },
  {
    label: "Watch",
    title: "Tour and wire",
    desc: "Lock in the comps, schedule the drive-by, set the deposit. Save the parcel to your watchlist for the next sale.",
    icon: SlidersHorizontal,
    visual: <FineTuneVisual />,
  },
  {
    label: "Export",
    title: "Export to lender",
    desc: "One-click CSV or JSON for your hard-money lender. PDF for your partner. Share link for your acquisitions team.",
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
                <p className="mt-4 max-w-[420px] text-[16px] leading-[1.6] text-[#6B7280] sm:text-[18px]">
                  Federal auctions update by the hour. County sheriffs post on
                  Tuesdays. Here&rsquo;s the loop from notice to bid &mdash; how
                  PerfectProperty turns a legal-prose filing into a deal you can
                  underwrite, tour, and wire to.
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
            <step.icon className="h-4 w-4 text-[#6B7280]" />
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#9CA3AF]">
              {step.label}
            </p>
          </div>
          <h3 className="text-[18px] font-semibold tracking-[-0.01em] text-[#111827]">
            {step.title}
          </h3>
          <p className="mt-1 text-[14px] leading-[1.6] text-[#6B7280]">
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
        <span className="ml-auto rounded-full bg-[#e7faef] px-2 py-0.5 text-[11px] font-bold text-[#3aaf57]">Active</span>
      </div>
      <div className="mt-3 space-y-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-[#6B7280]">ARV formula</span>
          <span className="font-mono text-[#111827]">comps × 0.92</span>
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-[#6B7280]">Offer rule</span>
          <span className="font-mono text-[#111827]">ARV × 0.70</span>
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-[#6B7280]">Market</span>
          <span className="font-medium text-[#111827]">Cleveland, OH</span>
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
        <span className="text-[12px] font-semibold text-[#111827]">123 Main St</span>
        <span className="ml-auto text-[11px] text-[#6B7280]">Cleveland, OH</span>
      </div>
      <div className="rounded-lg border border-[#E5E7EB] bg-white p-2.5">
        <p className="text-[11px] font-semibold uppercase text-[#9CA3AF]">Assessor</p>
        <p className="mt-1 text-[11px] text-[#111827]">$182k assessed</p>
      </div>
      <div className="rounded-lg border border-[#E5E7EB] bg-white p-2.5">
        <p className="text-[11px] font-semibold uppercase text-[#9CA3AF]">Distress</p>
        <p className="mt-1 text-[11px] text-[#B91C1C]">Code violation</p>
      </div>
      <div className="col-span-2 rounded-lg border border-[#E5E7EB] bg-white p-2.5">
        <p className="text-[11px] font-semibold uppercase text-[#9CA3AF]">Photos</p>
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
        <span className="text-[12px] text-[#6B7280]">Generate deal memo for 123 Main St</span>
      </div>
      <div className="rounded-lg border border-[#0F172A] bg-[#0F172A]/5 p-3">
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#0F172A]" />
          <span className="text-[11px] font-semibold text-[#0F172A]">Underwriting...</span>
        </div>
        <div className="mt-2 space-y-1">
          <div className="h-1.5 w-3/4 rounded-full bg-[#0F172A]/20" />
          <div className="h-1.5 w-1/2 rounded-full bg-[#0F172A]/20" />
        </div>
      </div>
      <div className="flex items-center gap-2 rounded-lg border border-[#e7faef] bg-[#e7faef]/50 p-2.5">
        <TrendingUp className="h-4 w-4 text-[#3aaf57]" />
        <span className="text-[11px] font-semibold text-[#3aaf57]">ARV $340k · Profit $52k</span>
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
        <SliderRow label="ARV" value="$340k" pct={85} />
        <SliderRow label="Offer" value="$248k" pct={62} />
        <SliderRow label="Profit" value="$52k" pct={45} accent />
      </div>
    </div>
  );
}

function SliderRow({ label, value, pct, accent }: { label: string; value: string; pct: number; accent?: boolean }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-[#6B7280]">{label}</span>
        <span className={`font-bold ${accent ? "text-[#3aaf57]" : "text-[#111827]"}`}>{value}</span>
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
        <span className="text-[12px] font-semibold text-[#111827]">123 Main St — Deal Memo</span>
      </div>
      {[
        { icon: Download, label: "PDF" },
        { icon: Download, label: "Video" },
        { icon: Link2, label: "Share link" },
        { icon: FileText, label: "Embed" },
      ].map(({ icon: Icon, label }) => (
        <div key={label} className="flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white p-2.5">
          <Icon className="h-3.5 w-3.5 text-[#6B7280]" />
          <span className="text-[11px] font-medium text-[#111827]">{label}</span>
        </div>
      ))}
    </div>
  );
}
