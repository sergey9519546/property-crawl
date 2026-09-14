"use client";

import * as React from "react";
import { FileText, Home, Sparkles, TrendingDown } from "lucide-react";
import type { PropertyListing } from "@/components/terminal/property-data";
import { chipToneClasses, computeTriageChips } from "@/lib/triage-chips";

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
  const chips = computeTriageChips(listing);
  if (chips.length === 0) return null;

  return (
    <ul
      aria-label="Listing triage flags"
      className={["flex flex-wrap items-center gap-1.5", className].filter(Boolean).join(" ")}
    >
      {chips.map((chip) => {
        const Icon = ICON[chip.icon];
        return (
          <li
            key={chip.key}
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${chipToneClasses(chip.tone)}`}
            data-triage-chip={chip.key}
          >
            <Icon size={iconSize} aria-hidden />
            <span>{chip.label}</span>
          </li>
        );
      })}
    </ul>
  );
}