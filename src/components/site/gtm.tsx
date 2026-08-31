"use client";

import * as React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GsapReveal } from "./gsap-reveal";
import {
  Megaphone,
  Target,
  Send,
  Calculator,
  FileText,
  Image as ImageIcon,
  Sparkles,
  Layers,
  Eye,
  Radar,
  Link2,
  FileDown,
  LayoutDashboard,
  Gauge,
  ShieldCheck,
  BarChart3,
  type LucideIcon,
} from "lucide-react";

const EASE_OUT = [0.16, 1, 0.3, 1] as const;

type Team = {
  key: string;
  label: string;
  icon: LucideIcon;
  desc: string;
  chips: { label: string; icon: LucideIcon }[];
  tint: string;
};

const TEAMS: Team[] = [
  {
    key: "marketing",
    label: "Marketing",
    icon: Megaphone,
    desc: "Create compelling, on-brand deal memos, ARV models, and visuals without the wait. Move fast to drive leads, boost adoption, and tell your market's story.",
    chips: [
      { label: "Deal memos", icon: FileText },
      { label: "ARV visuals", icon: ImageIcon },
      { label: "Brand kit", icon: Sparkles },
      { label: "Social sizzle", icon: Layers },
    ],
    tint: "#e7faef",
  },
  {
    key: "acquisitions",
    label: "Acquisitions",
    icon: Target,
    desc: "From parcel to offer in minutes. Win deals early with ranked rings and a versioned underwriting engine that surfaces what's actually a deal.",
    chips: [
      { label: "Deal Stacks", icon: LayoutDashboard },
      { label: "Shadow Mode", icon: Eye },
      { label: "Prophecy", icon: Sparkles },
      { label: "Monitoring", icon: Radar },
    ],
    tint: "#DBEAFE",
  },
  {
    key: "disposition",
    label: "Disposition",
    icon: Send,
    desc: "Beautiful deal memos your partners and lenders trust. Share custom links, embed on your site, or export as a PDF in a click.",
    chips: [
      { label: "Share links", icon: Link2 },
      { label: "Embed", icon: LayoutDashboard },
      { label: "PDF export", icon: FileDown },
      { label: "Partner portal", icon: ShieldCheck },
    ],
    tint: "#FFD6C8",
  },
  {
    key: "underwriting",
    label: "Underwriting",
    icon: Calculator,
    desc: "A versioned ARV, offer, and profit engine &mdash; with a Deal Score and a plain-English risk paragraph for every parcel. Audit-ready, every time.",
    chips: [
      { label: "Versioned engine", icon: Layers },
      { label: "Deal Score", icon: Gauge },
      { label: "Risk paragraph", icon: FileText },
      { label: "Accuracy view", icon: BarChart3 },
    ],
    tint: "#E9D5FF",
  },
];

export function Gtm() {
  const [active, setActive] = React.useState(0);
  const team = TEAMS[active];

  return (
    <section id="solutions" className="pt-24 pb-28 sm:pt-24 sm:pb-28">
      <div className="mx-auto max-w-[1080px] px-5 lg:px-8">
        <GsapReveal className="mx-auto max-w-[760px] text-center">
          <h2 className="text-[26px] font-medium leading-[1.17] tracking-[-0.015em] text-[#111827] sm:text-[32px] lg:text-[36px]">
            Empower your team to be better flippers.
          </h2>
          <p className="mx-auto mt-4 max-w-[600px] text-[16px] leading-[1.6] text-[#4B5563] sm:text-[18px]">
            Storytelling changes across the journey. Here&rsquo;s how different teams use
            PerfectProperty.
          </p>
        </GsapReveal>

        {/* Tabs — arcade style: shared light-gray pill, white floating active card, text-only */}
        <GsapReveal delay={0.7}>
          <div className="mt-10 inline-flex items-center gap-1 rounded-2xl bg-[rgba(17,24,39,0.06)] p-1">
            {TEAMS.map((t, i) => (
              <button
                key={t.key}
                onClick={() => setActive(i)}
                aria-pressed={active === i}
                className={`relative rounded-xl px-5 py-2.5 text-[14px] font-medium transition-colors ${
                  active === i ? "text-[#111827]" : "text-[#6B7280] hover:text-[#111827]"
                }`}
              >
                {active === i && (
                  <motion.span
                    layoutId="gtm-tab"
                    className="absolute inset-0 rounded-xl bg-white shadow-[0_1px_2px_rgba(17,24,39,0.06),0_1px_3px_rgba(17,24,39,0.05)]"
                    transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  />
                )}
                <span className="relative z-10">{t.label}</span>
              </button>
            ))}
          </div>
        </GsapReveal>

        {/* Panel — arcade style: no outer card/border, split text/visual on white */}
        <GsapReveal delay={0.75} y={16}>
          <div className="mt-10 grid grid-cols-1 items-stretch lg:grid-cols-2">
            {/* Left: copy */}
            <div className="py-2 lg:pr-10">
              <AnimatePresence mode="wait">
                <motion.div
                  key={team.key}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.3, ease: EASE_OUT }}
                >
                  <p className="text-[24px] font-semibold tracking-[-0.01em] text-[#111827] sm:text-[28px]">
                    PerfectProperty for {team.label}
                  </p>
                  <p
                    className="mt-4 text-[16px] leading-[1.6] text-[#6B7280] sm:text-[18px]"
                    dangerouslySetInnerHTML={{ __html: team.desc }}
                  />
                  <div className="mt-6 flex flex-wrap gap-2">
                    {team.chips.map((c) => (
                      <span
                        key={c.label}
                        className="inline-flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-[13px] font-medium text-[#111827]"
                      >
                        <c.icon className="h-4 w-4 text-[#6B7280]" />
                        {c.label}
                      </span>
                    ))}
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Right: visual on tinted bg, rounded */}
            <div className="relative min-h-[320px] overflow-hidden rounded-2xl lg:min-h-[400px]">
              <AnimatePresence mode="wait">
                <motion.div
                  key={team.key}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3, ease: EASE_OUT }}
                  className="absolute inset-0 flex items-center justify-center p-8"
                  style={{ backgroundColor: team.tint }}
                >
                  <GtmVisual team={team.key} />
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </GsapReveal>
      </div>
    </section>
  );
}

function GtmVisual({ team }: { team: string }) {
  if (team === "marketing") {
    return (
      <div className="w-full max-w-[300px] rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.05),0_12px_28px_rgba(0,0,0,0.08)]">
        <div className="aspect-[16/10] w-full overflow-hidden rounded-lg bg-[#F3F4F6]">
          <img
            src="https://images.unsplash.com/photo-1564013799919-ab600027ffc6?auto=format&fit=crop&w=600&q=60"
            alt="Deal memo"
            className="h-full w-full object-cover"
          />
        </div>
        <p className="mt-3 text-[13px] font-bold text-[#111827]">123 Main St</p>
        <p className="text-[11px] text-[#6B7280]">ARV $340k &middot; Profit $52k</p>
      </div>
    );
  }
  if (team === "acquisitions") {
    return (
      <div className="w-full max-w-[300px] space-y-2">
        {[
          { r: "Listed", a: "123 Main St", s: 88, c: "#e7faef" },
          { r: "Off-market", a: "88 Oak Ave", s: 81, c: "#DBEAFE" },
          { r: "Predicted", a: "404 Pine Rd", s: 74, c: "#E9D5FF" },
        ].map((row) => (
          <div
            key={row.a}
            className="flex items-center gap-3 rounded-xl border border-[#E5E7EB] bg-white p-2.5 shadow-sm"
          >
            <span
              className="rounded-md px-2 py-0.5 text-[11px] font-bold uppercase text-[#111827]"
              style={{ backgroundColor: row.c }}
            >
              {row.r}
            </span>
            <span className="flex-1 truncate text-[12px] font-semibold text-[#111827]">
              {row.a}
            </span>
            <span className="text-[12px] font-bold text-[#0F172A]">{row.s}</span>
          </div>
        ))}
      </div>
    );
  }
  if (team === "disposition") {
    return (
      <div className="w-full max-w-[300px] rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.05),0_12px_28px_rgba(0,0,0,0.08)]">
        <p className="text-[13px] font-bold text-[#111827]">Share deal memo</p>
        <p className="mt-1 text-[11px] text-[#6B7280]">perfectproperty.app/d/123-main</p>
        <div className="mt-3 flex gap-2">
          {["Link", "Embed", "PDF", "Video"].map((b) => (
            <span
              key={b}
              className="rounded-lg border border-[#E5E7EB] bg-[#F5F6F7] px-2.5 py-1 text-[11px] font-semibold text-[#111827]"
            >
              {b}
            </span>
          ))}
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[#F3F4F6]">
          <div className="h-full w-[64%] rounded-full bg-[#0F172A]" />
        </div>
        <p className="mt-1 text-[11px] text-[#6B7280]">64% opened by partners</p>
      </div>
    );
  }
  // underwriting
  return (
    <div className="w-full max-w-[300px] rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.05),0_12px_28px_rgba(0,0,0,0.08)]">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold text-[#111827]">Engine v3.2</span>
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#e7faef] text-[14px] font-bold text-[#3F6B00]">
          88
        </span>
      </div>
      <div className="mt-3 space-y-1.5">
        <Row label="ARV" value="$340k" />
        <Row label="Offer" value="$248k" />
        <Row label="Profit" value="$52k" green />
      </div>
      <p className="mt-3 rounded-lg bg-[#F5F6F7] p-2 text-[11px] leading-snug text-[#6B7280]">
        &ldquo;Occupied; Ohio allows confirmation delays; 10% deposit due day-of.&rdquo;
      </p>
    </div>
  );
}

function Row({ label, value, green }: { label: string; value: string; green?: boolean }) {
  return (
    <div className="flex items-center justify-between text-[12px]">
      <span className="text-[#6B7280]">{label}</span>
      <span className={`font-bold ${green ? "text-[#16A34A]" : "text-[#111827]"}`}>
        {value}
      </span>
    </div>
  );
}
