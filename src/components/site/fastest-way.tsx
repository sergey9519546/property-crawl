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
import { bandForScore } from "@/lib/score-bands";

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
    label: "Score",
    title: "See how the Deal Score works",
    desc: "Slide the opening bid. The Deal Score compares it to the county's value figure. It is a quick sort, not an appraisal.",
    href: "/listings",
    icon: Palette,
    visual: <DealKitVisual />,
  },
  {
    label: "Compare",
    title: "Check the county's number",
    desc: "Listings show the county's value figure next to the opening bid when one is published. If the data can't support a score, we leave it blank.",
    href: "/listings",
    icon: FileStack,
    visual: <ParcelContextVisual />,
  },
  {
    label: "Catch",
    title: "Read the catch",
    desc: "The catch lists the risks in plain English: the redemption period, liens, who lives there and deposit terms. Always check title before you bid.",
    href: "/listings",
    icon: Sparkles,
    visual: <PromptVisual />,
  },
  {
    label: "Save",
    title: "Save it and run your numbers",
    desc: "Save listings to your watchlist from the listings page. The sliders use only the amounts you enter, so the math is yours.",
    href: "/listings",
    icon: SlidersHorizontal,
    visual: <FineTuneVisual />,
  },
  {
    label: "Keep",
    title: "Keep a copy",
    desc: "Listings link to the original notice when the source publishes one, so you can keep your own records. Spreadsheet downloads are for staff only for now.",
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
          <div className="grid grid-cols-1 items-center gap-4 md:grid-cols-2">
            <GsapReveal>
              <div className="flex flex-col justify-center">
                <h2 className="text-[26px] font-medium leading-[1.17] tracking-[-0.015em] text-[#111827] sm:text-[32px] lg:text-[36px]">
                  From a posted sale to a confident bid.
                </h2>
                <p className="mt-4 max-w-[420px] text-[16px] leading-[1.6] text-[#5B6472] sm:text-[18px]">
                  Find a sale, read the catch, save it, and check the details
                  before you bid.
                </p>
              </div>
            </GsapReveal>
            <BentoCard step={first} delay={0.1} />
          </div>
          {/* Row 2 */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <BentoCard step={rest[0]} delay={0.2} />
            <BentoCard step={rest[1]} delay={0.3} />
          </div>
          {/* Row 3 */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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

// Visual demonstrations — media-first working interactive product widgets

function DealKitVisual() {
  const [openingBid, setOpeningBid] = React.useState(125000);
  const countyFigure = 210000;
  const ratio = openingBid / countyFigure;
  const dealScore = Math.max(1, Math.min(99, Math.round((1 - ratio) * 130)));
  const band = bandForScore(dealScore);

  return (
    <div className="w-full max-w-[280px] rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
      <div className="flex items-center gap-2 border-b border-[#F3F4F6] pb-2">
        <Palette className="h-4 w-4 text-[#0F172A]" />
        <span className="text-[12px] font-semibold text-[#111827]">Try it</span>
        <span className="ml-auto rounded-full bg-[#e7faef] px-2 py-0.5 text-[11px] font-bold text-[#15803D]">Example</span>
      </div>
      <div className="mt-3 space-y-2.5">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-[#5B6472]">County value</span>
          <span className="font-mono font-semibold text-[#111827]">${countyFigure.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-[#5B6472]">Opening Bid</span>
          <span className="font-mono font-semibold text-[#0F172A]">${openingBid.toLocaleString()}</span>
        </div>
        <input
          type="range"
          min={75000}
          max={200000}
          step={5000}
          value={openingBid}
          onChange={(e) => setOpeningBid(Number(e.target.value))}
          aria-label="Opening bid adjuster"
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-[#0F172A]"
        />
        <div className="flex items-center justify-between rounded-lg bg-[#F8FAFC] px-2.5 py-1.5 text-[11px]">
          <span className="font-medium text-[#5B6472]">Calculated Deal Score</span>
          <span
            className="font-mono font-bold"
            style={{ color: band?.color || "#5B6472" }}
          >
            {dealScore} / 99 ({band?.label || "Unrated"})
          </span>
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
        <span className="text-[12px] font-semibold text-[#111827]">1248 W 76th St</span>
        <span className="ml-auto text-[11px] font-medium text-emerald-700">Cleveland, OH</span>
      </div>
      <div className="rounded-lg border border-[#E5E7EB] bg-white p-2.5">
        <p className="text-[10px] font-semibold uppercase text-[#5B6472]">County value</p>
        <p className="mt-1 font-mono text-[12px] font-bold text-[#111827]">$145,000</p>
      </div>
      <div className="rounded-lg border border-[#E5E7EB] bg-white p-2.5">
        <p className="text-[10px] font-semibold uppercase text-[#5B6472]">Opening bid</p>
        <p className="mt-1 font-mono text-[12px] font-bold text-emerald-700">$62,000</p>
      </div>
      <div className="col-span-2 flex items-center justify-between rounded-lg border border-slate-200 bg-[#F8FAFC] px-3 py-2 text-[11px]">
        <span className="text-slate-600">Example listing only</span>
        <Link href="/listings?state=OH" className="font-semibold text-slate-900 underline hover:text-slate-700">
          Browse Ohio listings →
        </Link>
      </div>
    </div>
  );
}

function PromptVisual() {
  return (
    <div className="w-full max-w-[300px] space-y-2">
      <div className="flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white p-2.5">
        <Sparkles className="h-4 w-4 text-[#0F172A]" />
        <span className="text-[12px] font-semibold text-[#111827]">Example: the catch</span>
      </div>
      <div className="rounded-lg border border-amber-200 bg-amber-50/70 p-2.5 text-[11px] leading-relaxed text-amber-950">
        <strong className="block text-amber-900">Example catch:</strong>
        The sale may not be final until a judge confirms it. A deposit may be due on sale day. Check for liens before you bid.
      </div>
      <Link href="/listings" className="flex items-center justify-between rounded-lg border border-slate-300 bg-white px-3 py-2 text-[11px] font-semibold text-slate-900 hover:bg-slate-50">
        <span>See the catch on a listing</span>
        <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
      </Link>
    </div>
  );
}

function FineTuneVisual() {
  const [bid, setBid] = React.useState(110000);
  const [rehab, setRehab] = React.useState(25000);
  const estimatedVal = 195000;
  
  // Real underwriting arithmetic
  const targetMao = Math.round(estimatedVal * 0.70 - rehab);
  const estimatedCashClose = Math.round(bid + bid * 0.03 + 3500);

  return (
    <div className="w-full max-w-[280px] rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between border-b border-[#F3F4F6] pb-2">
        <div className="flex items-center gap-1.5">
          <SlidersHorizontal className="h-4 w-4 text-[#111827]" />
          <span className="text-[12px] font-semibold text-[#111827]">Example math</span>
        </div>
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono font-bold text-slate-700">Rule of thumb</span>
      </div>
      <div className="mt-3 space-y-2.5">
        <div>
          <div className="flex justify-between text-[11px]">
            <span className="text-[#5B6472]">Max Bid: ${bid.toLocaleString()}</span>
            <span className="font-semibold text-slate-900">Rehab: ${rehab.toLocaleString()}</span>
          </div>
          <input
            type="range"
            min={10000}
            max={60000}
            step={5000}
            value={rehab}
            onChange={(e) => setRehab(Number(e.target.value))}
            aria-label="Rehab budget slider"
            className="mt-1 h-1 w-full cursor-pointer appearance-none rounded-full bg-slate-200 accent-[#0F172A]"
          />
        </div>
        <div className="rounded-lg bg-slate-50 p-2 space-y-1 text-[11px]">
          <div className="flex justify-between">
            <span className="text-slate-600">Your value guess:</span>
            <span className="font-semibold text-slate-900">${estimatedVal.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-600">Your max bid (example):</span>
            <span className={`font-bold ${targetMao >= bid ? "text-emerald-700" : "text-amber-700"}`}>
              ${targetMao.toLocaleString()}
            </span>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-1">
            <span className="text-slate-600">Rough cash to close:</span>
            <span className="font-mono font-bold text-slate-900">${estimatedCashClose.toLocaleString()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function DownloadVisual() {
  const [downloading, setDownloading] = React.useState<"csv" | "json" | null>(null);

  const triggerDownload = (format: "csv" | "json") => {
    setDownloading(format);
    const link = document.createElement("a");
    link.href = `/api/export?format=${format}&limit=25`;
    link.download = `property-crawl-export.${format}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => setDownloading(null), 1200);
  };

  return (
    <div className="grid w-full max-w-[280px] grid-cols-2 gap-2">
      <div className="col-span-2 flex items-center justify-between rounded-lg border border-[#E5E7EB] bg-white p-2.5">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-[#0F172A]" />
          <span className="text-[12px] font-semibold text-[#111827]">Spreadsheet download</span>
        </div>
        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">Staff only</span>
      </div>
      <button
        type="button"
        onClick={() => triggerDownload("csv")}
        disabled={Boolean(downloading)}
        className="flex items-center justify-center gap-2 rounded-lg border border-[#E5E7EB] bg-white p-2.5 text-left hover:bg-[#F5F6F7] transition-colors disabled:opacity-50"
      >
        <Download className="h-3.5 w-3.5 text-[#5B6472]" />
        <span className="text-[11px] font-medium text-[#111827]">
          {downloading === "csv" ? "Downloading…" : "Download spreadsheet"}
        </span>
      </button>
      <button
        type="button"
        onClick={() => triggerDownload("json")}
        disabled={Boolean(downloading)}
        className="flex items-center justify-center gap-2 rounded-lg border border-[#E5E7EB] bg-white p-2.5 text-left hover:bg-[#F5F6F7] transition-colors disabled:opacity-50"
      >
        <FileText className="h-3.5 w-3.5 text-[#5B6472]" />
        <span className="text-[11px] font-medium text-[#111827]">
          {downloading === "json" ? "Downloading…" : "Download data file"}
        </span>
      </button>
    </div>
  );
}

