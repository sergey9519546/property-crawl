"use client";

import * as React from "react";
import { GsapReveal } from "./gsap-reveal";
import { ArrowRight, Eye, Sparkles, LayoutDashboard, FileText, TrendingUp, MapPin } from "lucide-react";

/**
 * ProductShowcaseStage — Arcade's layered compositing system:
 *   BACKGROUND → TEXTURE → LIGHT → CONTENT → PRODUCT ART → FOREGROUND UI → MASK/CROP → MOTION
 *
 * Layers:
 * 1. White page (section bg)
 * 2. Ambient blue bloom (huge, diffuse, behind everything)
 * 3. Inner glow (stronger, closer to product)
 * 4. Translucent product chrome (white/translucent, not mint)
 * 5. Format switcher bar (Deal/Shadow/Prophecy/Visuals)
 * 6. Product UI content (deal cards, metrics)
 * 7. Edge fades (top/bottom masks)
 */

type Format = "deal" | "shadow" | "prophecy" | "visuals";

const FORMATS: { key: Format; label: string; icon: typeof Eye }[] = [
  { key: "deal", label: "Deal Memo", icon: FileText },
  { key: "shadow", label: "Shadow", icon: Eye },
  { key: "prophecy", label: "Prophecy", icon: Sparkles },
  { key: "visuals", label: "Visuals", icon: LayoutDashboard },
];

const SOURCES = ["County", "Zillow", "PropStream", "Attom"];

export function Storyteller() {
  const [format, setFormat] = React.useState<Format>("deal");

  return (
    <section className="relative isolate overflow-hidden pt-24 pb-28">
      {/* Layer 1: White page (default) */}
      {/* Layer 2: Ambient blue bloom — huge, diffuse, far behind */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-20 z-0 -translate-x-1/2"
        style={{
          width: "min(1300px, 95vw)",
          height: "500px",
          background:
            "radial-gradient(ellipse at center, rgba(53,132,255,0.28) 0%, rgba(86,161,255,0.16) 35%, rgba(154,207,255,0.08) 57%, transparent 76%)",
          filter: "blur(40px)",
        }}
      />
      {/* Layer 3: Inner core glow — stronger, closer to product */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-40 z-0 -translate-x-1/2"
        style={{
          width: "min(900px, 80vw)",
          height: "350px",
          background:
            "radial-gradient(ellipse at center, rgba(15,23,42,0.15) 0%, rgba(15,23,42,0.06) 45%, transparent 70%)",
          filter: "blur(25px)",
        }}
      />

      <div className="relative z-10 mx-auto max-w-[1080px] px-5 lg:px-8">
        {/* Editorial heading — near-black, short line 1 / long line 2 silhouette */}
        <GsapReveal className="mx-auto max-w-[760px] text-center">
          <h2 className="text-[36px] font-medium leading-[1.17] tracking-[-0.015em] text-[#111827] sm:text-[36px]">
            You&rsquo;re the deal hunter.
            <br />
            PerfectProperty makes every deal effortless.
          </h2>
          <p className="mx-auto mt-6 max-w-[520px] text-[16px] leading-[1.6] text-[#6B7280]">
            In a crowded market, your deal story matters more than ever. But creating
            beautiful underwriting is painfully slow &mdash; until now.
          </p>
        </GsapReveal>

        {/* Layer 4-6: Product Showcase Stage */}
        <GsapReveal delay={0.3} y={24}>
          <div className="relative mt-16">
            {/* Layer 4: Frosted glass product chrome — glass-input token */}
            <div
              className="relative overflow-hidden rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12),inset_0_1px_0_rgba(255,255,255,0.7)]"
              style={{
                background: "rgba(255,255,255,0.85)",
                backdropFilter: "blur(20px) saturate(180%)",
                WebkitBackdropFilter: "blur(20px) saturate(180%)",
                border: "1px solid rgba(255,255,255,0.8)",
                willChange: "backdrop-filter",
              }}
            >
              {/* Layer 5: Format switcher bar (product-mode rail, not browser traffic lights) */}
              <div className="flex items-center gap-1 border-b border-[#F3F4F6] px-4 py-2.5">
                {FORMATS.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setFormat(f.key)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                      format === f.key
                        ? "bg-[#0F172A] text-white"
                        : "text-[#6B7280] hover:text-[#111827] hover:bg-[#F3F4F6]"
                    }`}
                  >
                    <f.icon className="h-3.5 w-3.5" strokeWidth={format === f.key ? 2.25 : 1.75} />
                    {f.label}
                  </button>
                ))}
                {/* Source badges (right side) */}
                <div className="ml-auto hidden items-center gap-1.5 sm:flex">
                  {SOURCES.map((s) => (
                    <span
                      key={s}
                      className="rounded-md border border-[#E5E7EB] bg-white px-2 py-0.5 text-[11px] font-medium text-[#6B7280]"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>

              {/* Layer 6: Product UI content — changes by format */}
              <div className="relative flex min-h-[440px] items-center justify-center px-6 py-10 sm:px-12 sm:py-14">
                <ProductContent format={format} />
              </div>

              {/* Layer 7: Bottom edge fade (crop/mask) */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 h-16"
                style={{
                  background:
                    "linear-gradient(to top, rgba(255,255,255,0.9) 0%, transparent 100%)",
                }}
              />
            </div>

            {/* Foreground: CTA row below the stage */}
            <div className="mt-6 flex items-center justify-between">
              <a
                href="#"
                className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-[#0F172A] hover:underline"
              >
                <Eye className="h-4 w-4" />
                Explore Shadow Mode
                <ArrowRight className="h-3.5 w-3.5" />
              </a>
              <a
                href="#"
                className="inline-flex h-10 items-center justify-center rounded-[12px] border border-[#E5E7EB] bg-white px-4 text-[14px] font-semibold text-[#111827] transition-colors hover:bg-[#F5F6F7]"
              >
                Get Started
              </a>
            </div>
          </div>
        </GsapReveal>
      </div>
    </section>
  );
}

/** Product UI content — changes based on selected format */
function ProductContent({ format }: { format: Format }) {
  if (format === "deal") {
    return (
      <div className="relative mx-auto flex max-w-[680px] flex-col items-center gap-5">
        {/* Primary deal card */}
        <div className="animate-float-soft relative w-full max-w-[440px] rounded-2xl border border-[#E5E7EB] bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_rgba(0,0,0,0.06)]">
          <div className="flex items-start gap-3">
            <img
              src="https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=160&q=60"
              alt="123 Main St"
              className="h-16 w-16 shrink-0 rounded-xl object-cover"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="truncate text-[15px] font-semibold text-[#111827]">123 Main St</p>
                <span className="inline-flex items-center gap-1 rounded-full bg-[#e7faef] px-2 py-0.5 text-[11px] font-bold text-[#3aaf57]">
                  <TrendingUp className="h-3 w-3" /> 88
                </span>
              </div>
              <p className="text-[12px] text-[#6B7280]">Cleveland, OH &middot; Listed ring</p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <Stat label="ARV" value="$340k" />
                <Stat label="Offer" value="$248k" />
                <Stat label="Profit" value="$52k" green />
              </div>
            </div>
          </div>
        </div>
        {/* Floating Shadow card */}
        <div className="animate-float-soft-2 absolute -right-4 top-0 hidden w-[200px] rotate-2 rounded-xl border border-[#E5E7EB] bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_28px_rgba(0,0,0,0.08)] sm:block">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#DBEAFE]">
              <Eye className="h-3.5 w-3.5 text-[#0F172A]" />
            </span>
            <p className="text-[12px] font-semibold text-[#111827]">Shadow match</p>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-[#6B7280]">
            Off-market &middot; code violation filed 6 days ago
          </p>
        </div>
      </div>
    );
  }
  if (format === "shadow") {
    return (
      <div className="mx-auto max-w-[500px] space-y-2">
        {[
          { ring: "Listed", addr: "123 Main St", score: 88, c: "#e7faef" },
          { ring: "Off-market", addr: "88 Oak Ave", score: 81, c: "#DBEAFE" },
          { ring: "Predicted", addr: "404 Pine Rd", score: 74, c: "#E9D5FF" },
        ].map((row) => (
          <div key={row.addr} className="flex items-center gap-3 rounded-xl border border-[#E5E7EB] bg-white p-3 shadow-sm">
            <span className="rounded-md px-2 py-0.5 text-[11px] font-bold uppercase text-[#111827]" style={{ backgroundColor: row.c }}>
              {row.ring}
            </span>
            <MapPin className="h-4 w-4 text-[#6B7280]" />
            <span className="flex-1 truncate text-[13px] font-semibold text-[#111827]">{row.addr}</span>
            <span className="text-[14px] font-bold text-[#0F172A]">{row.score}</span>
          </div>
        ))}
      </div>
    );
  }
  if (format === "prophecy") {
    return (
      <div className="mx-auto max-w-[400px] rounded-2xl border border-[#E5E7EB] bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-[#6B21A8]" />
          <p className="text-[16px] font-semibold text-[#111827]">Prophecy: 404 Pine Rd</p>
        </div>
        <p className="mt-3 text-[13px] text-[#6B7280]">Likely to list in:</p>
        <p className="text-[32px] font-bold text-[#111827]">~38 days</p>
        <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-[#F3F4F6]">
          <div className="h-full w-[72%] rounded-full bg-[#6B21A8]" />
        </div>
        <p className="mt-2 text-[11px] text-[#6B7280]">91% confidence &middot; based on 14 distress signals</p>
      </div>
    );
  }
  // visuals
  return (
    <div className="mx-auto grid max-w-[500px] grid-cols-2 gap-3">
      <img src="https://images.unsplash.com/photo-1568605114967-8130f3a36994?auto=format&fit=crop&w=300&q=60" alt="Property" className="aspect-[4/3] w-full rounded-xl object-cover" />
      <img src="https://images.unsplash.com/photo-1518780664697-55e3ad937233?auto=format&fit=crop&w=300&q=60" alt="Property" className="aspect-[4/3] w-full rounded-xl object-cover" />
      <div className="col-span-2 rounded-xl border border-[#E5E7EB] bg-white p-4">
        <p className="text-[12px] font-semibold uppercase text-[#9CA3AF]">ARV Model</p>
        <div className="mt-2 flex items-end gap-1.5">
          {[40, 64, 52, 80, 68, 96, 72].map((h, i) => (
            <div key={i} className="w-4 rounded-t bg-[#0F172A]/80" style={{ height: h }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, green }: { label: string; value: string; green?: boolean }) {
  return (
    <div className="rounded-lg bg-[#F5F6F7] py-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">{label}</p>
      <p className={`text-[13px] font-bold ${green ? "text-[#3aaf57]" : "text-[#111827]"}`}>{value}</p>
    </div>
  );
}
