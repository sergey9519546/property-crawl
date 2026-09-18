"use client";

import * as React from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronDown,
  Menu,
  X,
  LayoutDashboard,
  Eye,
  Radar,
  Gauge,
  Plug,
  Target,
  Send,
  Calculator,
  Landmark,
  BookOpen,
  Map,
  History,
  BarChart3,
  ArrowRight,
  KeyRound,
  type LucideIcon,
} from "lucide-react";
import { Logo } from "./logo";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

type MenuLink = {
  label: string;
  desc: string;
  icon: LucideIcon;
  href: string;
  tint?: string;
};

type MenuGroup = {
  key: string;
  label: string;
  columns?: MenuLink[][];
  simple?: { label: string; href: string }[];
};

// Product nav maps to shipped beta surfaces. Phantom roadmap names are labeled.
const GROUPS: MenuGroup[] = [
  {
    key: "product",
    label: "Product",
    columns: [
      [
        { label: "Listing workspace", desc: "Search grid, map, and deal detail", icon: LayoutDashboard, href: "/listings", tint: "#e7faef" },
        { label: "Source Radar", desc: "Coverage, trust status, and collector health", icon: Plug, href: "/sources", tint: "#E2E8F0" },
        { label: "Saved Hunts", desc: "Explain matches and track evidence changes", icon: Radar, href: "/hunts", tint: "#FFD6C8" },
      ],
      [
        { label: "Second Look", desc: "Research cases and reconsideration queue", icon: Eye, href: "/research", tint: "#E9D5FF" },
        { label: "Collection activity", desc: "Jobs, runs, and ingestion health", icon: History, href: "/activity", tint: "#e7faef" },
        { label: "What's in beta", desc: "Shipped vs roadmap capability matrix", icon: Gauge, href: "/#pricing", tint: "#E2E8F0" },
      ],
    ],
  },
  {
    key: "solutions",
    label: "Solutions",
    columns: [
      [
        { label: "Acquisitions", desc: "Triage from source record to research case", icon: Target, href: "/listings", tint: "#e7faef" },
        { label: "Disposition", desc: "Evidence-backed deal notes (beta)", icon: Send, href: "/listings", tint: "#FFD6C8" },
      ],
      [
        { label: "Underwriting", desc: "Cash inputs, assumptions, and gaps", icon: Calculator, href: "/listings", tint: "#E2E8F0" },
        { label: "Capital", desc: "Lender-ready evidence packages (roadmap)", icon: Landmark, href: "/#pricing", tint: "#E9D5FF" },
      ],
    ],
  },
  {
    key: "resources",
    label: "Resources",
    columns: [
      [
        { label: "Knowledge base", desc: "How to use the beta workflow", icon: BookOpen, href: "/resources#knowledge-base", tint: "#E2E8F0" },
        { label: "County guides", desc: "Jurisdiction differences before you bid", icon: Map, href: "/resources#guides", tint: "#FFD6C8" },
        { label: "Changelog", desc: "What shipped in this build", icon: History, href: "/resources#changelog", tint: "#E9D5FF" },
      ],
      [
        { label: "Scraper power report", desc: "Source coverage vs live inventory limits", icon: BarChart3, href: "/sources", tint: "#e7faef" },
        { label: "Operator access", desc: "Shared-key private beta model", icon: KeyRound, href: "/sign-in", tint: "#E2E8F0" },
      ],
    ],
  },
];

function MegaPanel({ group }: { group: MenuGroup }) {
  if (group.simple) {
    return (
      <div className="mx-auto max-w-[640px] px-6 py-6">
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
          {group.simple.map((l) => (
            <Link
              key={l.label}
              href={l.href}
              className="rounded-lg px-3 py-2 text-[14px] font-medium text-[#111827] hover:bg-[#F3F4F6]"
            >
              {l.label}
            </Link>
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-[760px] px-6 py-6">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        {group.columns?.map((col, ci) => (
          <div key={ci} className="grid gap-1.5">
            {col.map((l) => (
              <Link
                key={l.label}
                href={l.href}
                className="group flex items-start gap-3 rounded-xl p-2.5 hover:bg-[#F3F4F6]"
              >
                <span
                  className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                  style={{ backgroundColor: l.tint ?? "#F3F4F6" }}
                >
                  <l.icon className="h-[18px] w-[18px] text-[#111827]" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold text-[#111827]">
                    {l.label}
                  </span>
                  <span className="block text-[13px] leading-snug text-[#6B7280]">
                    {l.desc}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SiteHeader() {
  const [open, setOpen] = React.useState<string | null>(null);
  const [scrolled, setScrolled] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 100);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div
      // Outer layer: fixed, full-width, transparent. Handles sticky positioning only.
      className="fixed inset-x-0 top-4 z-50"
      style={{ padding: "12px 0" }}
    >
      <div className="mx-auto w-[calc(100%-32px)] sm:w-[calc(100%-48px)] lg:w-[calc(100%-64px)]">
        {/* Inner capsule: the visual nav shell. Transparent at top, white+blur+rounded when scrolled.
            Arcade: transition 0.2s, scroll threshold ~100px, wider container, tighter nav spacing */}
        <header
          className={`relative flex items-center justify-between rounded-[16px] px-4 py-3 sm:px-8 transition-all duration-500 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] ${
            scrolled || open
              ? "bg-white/70 backdrop-blur-2xl backdrop-saturate-[2] border border-white/40 shadow-[0_8px_32px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.8)]"
              : "bg-transparent shadow-none border border-transparent"
          }`}
          style={{ willChange: scrolled || open ? "backdrop-filter" : "auto" }}
        >
        {/* Brand is pinned left; desktop nav is centered independently. */}
        <div className="flex items-center">
          <Link href="/" className="flex items-center gap-3" aria-label="PerfectProperty home">
            <Logo className="text-[14px] min-[375px]:text-[16px] sm:text-[20px]" />
          </Link>
        </div>

        <nav
          className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center gap-[34px] xl:flex"
          onMouseLeave={() => setOpen(null)}
        >
            {GROUPS.map((g) => (
              <button
                key={g.key}
                onMouseEnter={() => setOpen(g.key)}
                onFocus={() => setOpen(g.key)}
                onClick={() => setOpen(g.key)}
                aria-haspopup="menu"
                aria-expanded={open === g.key}
                className="inline-flex h-10 items-center text-[14px] font-semibold text-[#374151] transition-colors hover:text-[#111827]"
              >
                {g.label}
              </button>
            ))}
            {/* Arcade: Enterprise is a plain link (not dropdown) */}
            <Link
              href="/enterprise"
              onMouseEnter={() => setOpen(null)}
              className="inline-flex h-10 items-center text-[14px] font-semibold text-[#374151] transition-colors hover:text-[#111827]"
            >
              Enterprise
            </Link>
            <Link
              href="#pricing"
              onMouseEnter={() => setOpen(null)}
              className="inline-flex h-10 items-center text-[14px] font-semibold text-[#374151] transition-colors hover:text-[#111827]"
            >
              Pricing
            </Link>
        </nav>

        {/* Right: CTA — single dark button, rounded-[12px] */}
        <div className="hidden xl:flex items-center gap-2">
          <Link
            href="/listings"
            onMouseEnter={() => setOpen(null)}
            className="inline-flex h-10 items-center justify-center rounded-[12px] bg-[#0F172A] px-4 text-[14px] font-bold text-white transition-colors hover:bg-[#1E293B]"
          >
            Open listings
          </Link>
          <Link
            href="/sign-in"
            onMouseEnter={() => setOpen(null)}
            title="Shared operator key — private beta"
            className="inline-flex h-10 items-center justify-center rounded-[12px] border border-[#D1D5DB] px-3 text-[13px] font-semibold text-[#374151] transition-colors hover:bg-white"
          >
            Operator key
          </Link>
        </div>

        {/* Mobile trigger */}
        <button
          className="xl:hidden inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[#111827] hover:bg-[#F3F4F6]"
          aria-label="Open menu"
          onClick={() => setMobileOpen(true)}
        >
          <Menu className="h-5 w-5" />
        </button>
        </header>
      </div>

      {/* Mega panel (desktop) — outside the capsule, inside the fixed outer */}
      <AnimatePresence>
        {open && (
          <motion.div
            data-testid="desktop-mega-menu"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-x-0 top-full hidden xl:block"
            onMouseEnter={() => setOpen(open)}
            onMouseLeave={() => setOpen(null)}
          >
            <div className="mx-auto w-[calc(100%-32px)] sm:w-[calc(100%-48px)] lg:w-[calc(100%-64px)]">
              <div className="mt-2 overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.05),0_12px_32px_rgba(0,0,0,0.08)]">
                {GROUPS.filter((g) => g.key === open).map((g) => (
                  <MegaPanel key={g.key} group={g} />
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Mobile sheet */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        {mobileOpen && (
          <SheetContent side="right" className="w-[320px] overflow-y-auto p-0">
            <SheetDescription className="sr-only">
              PerfectProperty navigation menu
            </SheetDescription>
            <SheetHeader className="flex flex-row items-center border-b border-[#F3F4F6] px-5 py-4 pr-12">
              <SheetTitle asChild>
                <span className="flex items-center">
                  <Logo className="text-[16px]" />
                </span>
              </SheetTitle>
            </SheetHeader>
            <Accordion type="multiple" className="px-2 py-2">
              {GROUPS.map((g) => (
                <AccordionItem key={g.key} value={g.key} className="border-b-0">
                  <AccordionTrigger className="px-3 text-[15px] font-semibold text-[#111827] hover:no-underline">
                    {g.label}
                  </AccordionTrigger>
                  <AccordionContent className="px-1 pb-2">
                    <div className="grid gap-0.5">
                      {g.simple
                        ? g.simple.map((l) => (
                            <Link
                              key={l.label}
                              href={l.href}
                              onClick={() => setMobileOpen(false)}
                              className="rounded-lg px-3 py-2 text-[14px] text-[#4B5563] hover:bg-[#F3F4F6]"
                            >
                              {l.label}
                            </Link>
                          ))
                        : g.columns?.flat().map((l) => (
                            <Link
                              key={l.label}
                              href={l.href}
                              onClick={() => setMobileOpen(false)}
                              className="flex items-start gap-3 rounded-lg px-3 py-2 hover:bg-[#F3F4F6]"
                            >
                              <span
                                className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg"
                                style={{ backgroundColor: l.tint ?? "#F3F4F6" }}
                              >
                                <l.icon className="h-4 w-4 text-[#111827]" />
                              </span>
                              <span>
                                <span className="block text-[14px] font-semibold text-[#111827]">
                                  {l.label}
                                </span>
                                <span className="block text-[12px] text-[#6B7280]">
                                  {l.desc}
                                </span>
                              </span>
                            </Link>
                          ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
              <Link href="/enterprise" onClick={() => setMobileOpen(false)} className="block rounded-lg px-3 py-3 text-[15px] font-semibold text-[#111827] hover:bg-[#F3F4F6]">
                Enterprise
              </Link>
              <Link href="#pricing" onClick={() => setMobileOpen(false)} className="block rounded-lg px-3 py-3 text-[15px] font-semibold text-[#111827] hover:bg-[#F3F4F6]">
                Pricing
              </Link>
            </Accordion>
            <div className="mt-2 grid gap-2 border-t border-[#F3F4F6] px-5 py-4">
              <Link
                href="/listings"
                onClick={() => setMobileOpen(false)}
                className="inline-flex h-10 items-center justify-center rounded-[12px] bg-[#0F172A] px-4 text-[14px] font-semibold text-white"
              >
                Open listings
              </Link>
              <Link
                href="/sign-in"
                onClick={() => setMobileOpen(false)}
                className="inline-flex h-10 items-center justify-center rounded-[12px] border border-[#D1D5DB] px-4 text-[14px] font-semibold text-[#374151]"
              >
                Operator key
              </Link>
            </div>
          </SheetContent>
        )}
      </Sheet>
    </div>
  );
}
