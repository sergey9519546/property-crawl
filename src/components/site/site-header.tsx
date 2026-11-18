"use client";

import * as React from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Menu,
  LayoutDashboard,
  Radar,
  Gauge,
  Target,
  Calculator,
  Landmark,
  BookOpen,
  Map,
  History,
  BarChart3,
  PieChart,
  KeyRound,
  type LucideIcon,
} from "lucide-react";
import { Logo } from "./logo";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { useLocale } from "@/components/i18n/locale-provider";
import type { Messages } from "@/lib/i18n/messages";
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

// Product nav maps to shipped beta surfaces. Keep exact hrefs visible for route checks.
function buildMenuGroups(m: Messages): MenuGroup[] {
  const p = m.header.productItems;
  const l = m.header.learnItems;
  return [
    {
      key: "product",
      label: m.header.productLabel,
      columns: [
        [
          { label: p.listingsLabel, desc: p.listingsDesc, icon: LayoutDashboard, href: "/listings", tint: "#e7f8f0" },
          { label: p.catchLabel, desc: p.catchDesc, icon: Target, href: "/#the-catch", tint: "#fff0e9" },
          { label: p.underwriteLabel, desc: p.underwriteDesc, icon: Calculator, href: "/#product", tint: "#eef1ff" },
        ],
        [
          { label: p.huntsLabel, desc: p.huntsDesc, icon: Radar, href: "/hunts", tint: "#e7f8f0" },
          { label: p.portfolioLabel, desc: p.portfolioDesc, icon: PieChart, href: "/portfolio", tint: "#eef1ff" },
          { label: p.researchLabel, desc: p.researchDesc, icon: BookOpen, href: "/research", tint: "#fff0e9" },
        ],
      ],
    },
    {
      key: "learn",
      label: m.header.learnLabel,
      columns: [
        [
          { label: l.guideLabel, desc: l.guideDesc, icon: BookOpen, href: "/resources#knowledge-base", tint: "#e5e7eb" },
          { label: l.faqLabel, desc: l.faqDesc, icon: Gauge, href: "/#faq", tint: "#e5e7eb" },
          { label: l.statesLabel, desc: l.statesDesc, icon: Map, href: "/states", tint: "#e5e7eb" },
        ],
        [
          { label: l.changelogLabel, desc: l.changelogDesc, icon: History, href: "/resources#changelog", tint: "#e5e7eb" },
          { label: l.sourcesLabel, desc: l.sourcesDesc, icon: BarChart3, href: "/sources", tint: "#e5e7eb" },
          { label: l.caseStudiesLabel, desc: l.caseStudiesDesc, icon: BookOpen, href: "/case-studies", tint: "#e5e7eb" },
          { label: l.enterpriseLabel, desc: l.enterpriseDesc, icon: Landmark, href: "/enterprise", tint: "#e5e7eb" },
          { label: l.staffSignInLabel, desc: l.staffSignInDesc, icon: KeyRound, href: "/sign-in", tint: "#e5e7eb" },
        ],
      ],
    },
  ];
}

function MegaPanel({ group }: { group: MenuGroup }) {
  if (group.simple) {
    return (
      <div className="mx-auto max-w-[640px] px-6 py-6">
        <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
          {group.simple.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-control px-3 py-2 text-meta font-medium text-ink hover:bg-paper"
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
                key={l.href}
                href={l.href}
                className="group flex items-start gap-3 rounded-control p-2.5 hover:bg-paper"
              >
                <span
                  className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-control"
                  style={{ backgroundColor: l.tint ?? "#F3F4F6" }}
                >
                  <l.icon className="h-[18px] w-[18px] text-ink" />
                </span>
                <span className="min-w-0">
                  <span className="block text-meta font-semibold text-ink">
                    {l.label}
                  </span>
                  <span className="block text-xs leading-snug text-ink-3">
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
  const { messages } = useLocale();
  const groups = React.useMemo(() => buildMenuGroups(messages), [messages]);
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
      className="fixed inset-x-0 top-4 z-50"
      style={{ padding: "12px 0" }}
    >
      <div className="mx-auto w-[calc(100%-32px)] sm:w-[calc(100%-48px)] lg:w-[calc(100%-64px)]">
        <header
          className={`relative flex items-center justify-between gap-4 xl:grid xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] rounded-control px-4 py-3 sm:px-8 transition-all duration-500 ease-[cubic-bezier(0.25,0.46,0.45,0.94)] ${
            scrolled || open
              ? "bg-card/70 backdrop-blur-2xl backdrop-saturate-[2] border border-white/40 shadow-[0_8px_32px_rgba(0,0,0,0.08),inset_0_1px_0_rgba(255,255,255,0.8)]"
              : "bg-transparent shadow-none border border-transparent"
          }`}
          style={{ willChange: scrolled || open ? "backdrop-filter" : "auto" }}
        >
        <div className="flex min-w-0 shrink-0 items-center xl:justify-self-start">
          <Link href="/" className="flex min-w-0 items-center gap-3" aria-label={messages.common.homeAria}>
            <Logo className="text-sm min-[375px]:text-base sm:text-lg" />
          </Link>
        </div>

        <nav
          className="hidden items-center justify-center gap-6 xl:flex xl:justify-self-center 2xl:gap-8"
          onMouseLeave={() => setOpen(null)}
        >
            {groups.map((g) => (
              <button
                key={g.key}
                onMouseEnter={() => setOpen(g.key)}
                onFocus={() => setOpen(g.key)}
                onClick={() => setOpen(g.key)}
                aria-haspopup="menu"
                aria-expanded={open === g.key}
                className="inline-flex h-10 shrink-0 items-center whitespace-nowrap text-meta font-semibold text-ink-2 transition-colors hover:text-ink"
              >
                {g.label}
              </button>
            ))}
            <Link
              href="/#pricing"
              onMouseEnter={() => setOpen(null)}
              className="inline-flex h-10 shrink-0 items-center whitespace-nowrap text-meta font-semibold text-ink-2 transition-colors hover:text-ink"
            >
              {messages.common.pricing}
            </Link>
        </nav>

        <div className="hidden shrink-0 items-center gap-2 xl:flex xl:justify-self-end">
          <LanguageSwitcher />
          <Link
            href="/listings"
            onMouseEnter={() => setOpen(null)}
            className="inline-flex h-10 shrink-0 items-center justify-center whitespace-nowrap rounded-control bg-ink px-4 text-meta font-bold text-white transition-colors hover:bg-ink-2"
          >
            {messages.common.browseListings}
          </Link>
          <Link
            href="/account"
            onMouseEnter={() => setOpen(null)}
            title={messages.header.signInTitle}
            className="inline-flex h-10 shrink-0 items-center justify-center whitespace-nowrap rounded-control border border-line-strong px-3 text-meta font-semibold text-ink-2 transition-colors hover:bg-card"
          >
            {messages.common.signIn}
          </Link>
        </div>

        {/* Mobile actions */}
        <div className="flex items-center gap-1.5 xl:hidden">
          <LanguageSwitcher />
          <button
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-control text-ink hover:bg-paper"
            aria-label={messages.header.openMenu}
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
        </header>
      </div>

      {/* Mega panel (desktop) */}
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
              <div className="mt-2 overflow-hidden rounded-card border border-line bg-card shadow-[0_1px_2px_rgba(0,0,0,0.05),0_12px_32px_rgba(0,0,0,0.08)]">
                {groups.filter((g) => g.key === open).map((g) => (
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
              {messages.header.navMenuAria}
            </SheetDescription>
            <SheetHeader className="flex flex-row items-center border-b border-paper px-5 py-4 pr-12">
              <SheetTitle asChild>
                <span className="flex items-center">
                  <Logo className="text-base" />
                </span>
              </SheetTitle>
            </SheetHeader>
            <Accordion type="multiple" className="px-2 py-2">
              {groups.map((g) => (
                <AccordionItem key={g.key} value={g.key} className="border-b-0">
                  <AccordionTrigger className="px-3 text-body font-semibold text-ink hover:no-underline">
                    {g.label}
                  </AccordionTrigger>
                  <AccordionContent className="pb-2 pt-1">
                    <div className="grid gap-1 px-1">
                      {g.simple
                        ? g.simple.map((l) => (
                            <Link
                              key={l.href}
                              href={l.href}
                              onClick={() => setMobileOpen(false)}
                              className="rounded-control px-3 py-2 text-meta text-ink-2 hover:bg-paper"
                            >
                              {l.label}
                            </Link>
                          ))
                        : g.columns?.flat().map((l) => (
                            <Link
                              key={l.href}
                              href={l.href}
                              onClick={() => setMobileOpen(false)}
                              className="flex items-start gap-3 rounded-control px-3 py-2 hover:bg-paper"
                            >
                              <span
                                className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-control"
                                style={{ backgroundColor: l.tint ?? "#F3F4F6" }}
                              >
                                <l.icon className="h-4 w-4 text-ink" />
                              </span>
                              <span>
                                <span className="block text-meta font-semibold text-ink">
                                  {l.label}
                                </span>
                                <span className="block text-xs text-ink-3">
                                  {l.desc}
                                </span>
                              </span>
                            </Link>
                          ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              ))}
              <Link href="/#pricing" onClick={() => setMobileOpen(false)} className="block rounded-control px-3 py-3 text-body font-semibold text-ink hover:bg-paper">
                {messages.common.pricing}
              </Link>
            </Accordion>
            <div className="border-t border-paper px-5 py-4">
              <p className="mb-2 text-label font-bold uppercase tracking-wider text-ink-3">
                {messages.common.languageLabel}
              </p>
              <LanguageSwitcher variant="inline" />
            </div>
            <div className="grid gap-2 border-t border-paper px-5 py-4">
              <Link
                href="/listings"
                onClick={() => setMobileOpen(false)}
                className="inline-flex h-10 items-center justify-center rounded-control bg-ink px-4 text-meta font-semibold text-white"
              >
                {messages.common.browseListings}
              </Link>
              <Link
                href="/account"
                onClick={() => setMobileOpen(false)}
                className="inline-flex h-10 items-center justify-center rounded-control border border-line-strong px-4 text-meta font-semibold text-ink-2"
              >
                {messages.common.signIn}
              </Link>
            </div>
          </SheetContent>
        )}
      </Sheet>
    </div>
  );
}
