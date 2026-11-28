"use client";

import * as React from "react";
import { FileText, Home, Sparkles, TrendingDown } from "lucide-react";
import type { PropertyListing } from "@/components/terminal/property-data";
import { chipToneClasses, computeTriageChips } from "@/lib/triage-chips";
import { useLocale } from "@/components/i18n/locale-provider";

const ICON: Record<"Sparkles" | "TrendingDown" | "FileText" | "Home", typeof Sparkles> = {
  Sparkles,
  TrendingDown,
  FileText,
  Home,
};

type Props = {
  listing: Pick<PropertyListing, "triage" | "sourceObservedAt">;
  className?: string;
  iconSize?: number;
};

export function TriageChips({ listing, className, iconSize = 11 }: Props) {
  const { locale, messages: m } = useLocale();
  const chips = computeTriageChips(listing);
  if (chips.length === 0) return null;

  const listClass = ["flex flex-wrap items-center gap-1.5", className].filter(Boolean).join(" ");
  const items = chips.map((rawChip) => {
    const Icon = ICON[rawChip.icon];
    const chip = locale === "en" ? rawChip : { ...rawChip, label: m.listingsUi.triageChips[rawChip.key] };
    return (
      <li
        key={chip.key}
        className={`inline-flex items-center gap-1 rounded-control px-1.5 py-0.5 text-label font-semibold ${chipToneClasses(chip.tone)}`}
        data-triage-chip={chip.key}
      >
        <Icon size={iconSize} aria-hidden />
        <span>{chip.label}</span>
      </li>
    );
  });

  return (
    // Localized equivalent of aria-label="Listing triage flags"
    <ul aria-label={m.listingsUi.triageChips.groupAria} className={listClass}>
      {items}
    </ul>
  );
}
