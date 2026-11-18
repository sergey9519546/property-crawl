"use client";

import * as React from "react";
import { factText, type FactFormat, type FactOrigin, type UnknownReason } from "@/lib/evidence";
import { useLocale } from "@/components/i18n/locale-provider";

/**
 * Evidence ink: the one way to show a value about a property.
 *
 *   printed  published by the source            -> plain ink
 *   yours    typed by the buyer (an estimate)     -> periwinkle pencil, "yours"
 *   unknown  nobody has published it             -> persimmon hatch, same footprint
 *
 * "unknown" is never chosen by the caller: it is what happens when the value is
 * missing. So a gap can't be styled away, and a guess can't pass as a fact.
 */
export type { FactOrigin, FactFormat, UnknownReason } from "@/lib/evidence";

export function Fact({
  value,
  format = "text",
  origin = "unverified",
  reason = "Not in the notice",
  className = "",
}: {
  value: unknown;
  format?: FactFormat;
  origin?: FactOrigin;
  reason?: UnknownReason;
  className?: string;
}) {
  const { locale, messages: m } = useLocale();
  const text = origin === "yours" && format === "money" && value === 0 ? "$0" : factText(value, format);
  const displayReason =
    locale !== "en"
      ? reason === "Not in the notice"
        ? m.detailUi.factUnknownReason
        : reason === "Set at the sale"
          ? m.designB2.reasonSaleDayVal
          : reason === "Not checked yet"
            ? m.designB2.reasonNotCheckedVal
            : reason
      : reason;
  if (text === null) {
    return (
      <span data-evidence="unknown" className={`ev-unknown inline-block text-[0.8em] font-semibold ${className}`}>
        <span className="sr-only">Unknown: </span>
        {displayReason}
      </span>
    );
  }
  if (origin === "yours") {
    return (
      <span data-evidence="yours" className={`ev-yours ${className}`}>
        <span className="sr-only">Your estimate: </span>
        {text}
      </span>
    );
  }
  return (
    <span data-evidence={origin} title={origin === "unverified" ? "Source provenance has not been verified" : undefined} className={`${origin === "printed" ? "ev-printed" : "ev-unknown"} ${className}`}>
      {origin === "unverified" && <span className="sr-only">Unverified: </span>}
      {text}
    </span>
  );
}

/** A small "yours" flag to sit next to buyer-typed inputs and results. */
export function YoursTag() {
  const { locale, messages: m } = useLocale();
  return (
    <span className="ml-1.5 inline-flex rounded-full bg-[var(--color-yours-wash)] px-1.5 py-0.5 align-middle text-label font-bold uppercase tracking-wider text-[var(--color-yours)]">
      {locale === "en" ? "yours" : m.detailUi.factYoursTag}
    </span>
  );
}
