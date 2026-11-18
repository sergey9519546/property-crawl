"use client";

import { GsapStaggerGroup } from "./gsap-reveal";
import { SectionHeading } from "./section-heading";
import { Check, Sparkles } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/components/i18n/locale-provider";

type Col = {
  name: string;
  tag: string;
  features: { label: string; ok: boolean }[];
  highlight?: boolean;
  cta?: boolean;
};

function useMemberPrice(targetRef: React.RefObject<HTMLElement | null>) {
  const { intlLocale } = useLocale();
  const [label, setLabel] = useState<string | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = targetRef.current;
    if (!el || inView) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          obs.disconnect();
        }
      },
      { rootMargin: "400px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [inView, targetRef]);

  useEffect(() => {
    if (!inView) return;
    let cancelled = false;
    fetch("/api/checkout", { cache: "no-store" })
      .then((response) => response.json())
      .then((body) => {
        const price = body?.price;
        if (cancelled || !price || typeof price.unitAmount !== "number" || typeof price.currency !== "string") return;
        const safeCurrencyLocale = intlLocale === "hy-AM" ? "en-US" : intlLocale;
        const amount = new Intl.NumberFormat(safeCurrencyLocale, { style: "currency", currency: price.currency.toUpperCase() }).format(price.unitAmount / 100);
        setLabel(price.interval ? `${amount} / ${price.interval}` : amount);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [inView, intlLocale]);
  return label;
}

export function AiComparison() {
  const { locale, messages } = useLocale();
  const p = messages.home.aiComparison;
  const sectionRef = useRef<HTMLElement | null>(null);
  const memberPrice = useMemberPrice(sectionRef);

  const cols: Col[] = [
    {
      name: p.freeName,
      tag: p.freeTag,
      features: p.freeFeatures.map((label) => ({ label, ok: true })),
    },
    {
      name: p.memberName,
      tag: p.memberTag,
      highlight: true,
      cta: true,
      features: p.memberFeatures.map((label) => ({ label, ok: true })),
    },
  ];

  const startSearchingLabel = locale === "hy" ? "Սկսել որոնումը" : locale === "ru" ? "Начать поиск" : "Start searching";
  const becomeMemberLabel = messages.home.secondLook.becomeMember;
  const footnote = locale === "hy"
    ? "Երկու պլաններում էլ ներառված չեն՝ title report-ներ, վաճառված համադրելի գործարքներ կամ բոլոր շրջանների վաճառքներ։"
    : locale === "ru"
      ? "Ни в один тариф не входят отчёты по титулу, архив рыночных сделок или лоты в каждом округе."
      : "Not included in either plan: title reports, sold-price comparables, or a sale in every county.";
  const whyLabel = locale === "hy" ? "Ինչո՞ւ" : locale === "ru" ? "Почему?" : "Why?";

  return (
    <section ref={sectionRef} id="pricing" className="scroll-mt-24 px-5 pt-24 pb-28 lg:px-8">
      <div className="mx-auto max-w-[880px]">
        <SectionHeading eyebrow={p.eyebrow} title={p.title}>
          {p.subtitle}
        </SectionHeading>

        <GsapStaggerGroup className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2" stagger={0.15}>
          {cols.map((col) => (
            <div
              key={col.name}
              data-stagger-item
              className={`flex flex-col rounded-card border p-7 ${
                col.highlight
                  ? "border-ink bg-card ring-1 ring-ink shadow-raised"
                  : "border-line bg-card shadow-card"
              }`}
            >
              <div className="flex items-center justify-between">
                <h3 className="text-title font-semibold text-ink">{col.name}</h3>
                {col.highlight && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-ink px-2.5 py-0.5 text-label font-bold text-white">
                    <Sparkles className="h-3 w-3" /> {p.alertsBadge}
                  </span>
                )}
              </div>
              <p className="mt-3 text-title font-semibold tracking-[-0.02em] text-ink sm:text-display">
                {col.cta ? memberPrice ?? p.memberFallbackPrice : "$0"}
              </p>
              <p className="text-meta font-medium text-ink-3">{col.cta ? p.cancelAnytime : col.tag}</p>
              <ul className="mt-6 flex-1 space-y-3">
                {col.features.map((f) => (
                  <li key={f.label} className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ink/10">
                      <Check className="h-3 w-3 text-ink" />
                    </span>
                    <span className="text-body leading-6 text-ink">{f.label}</span>
                  </li>
                ))}
              </ul>
              {col.cta ? (
                <Link href="/account" className="mt-7 inline-flex h-11 w-full items-center justify-center rounded-control bg-ink text-meta font-semibold text-white hover:bg-ink-2">
                  {becomeMemberLabel}
                </Link>
              ) : (
                <Link href="/listings" className="mt-7 inline-flex h-11 w-full items-center justify-center rounded-control border border-line-strong text-meta font-semibold text-ink hover:bg-card">
                  {startSearchingLabel}
                </Link>
              )}
            </div>
          ))}
        </GsapStaggerGroup>
        <p className="mt-6 text-center text-meta text-ink-3">
          {footnote} <a href="#faq" className="font-semibold text-ink underline underline-offset-4">{whyLabel}</a>
        </p>
      </div>
    </section>
  );
}
