import * as React from "react";
import { factText, type FactFormat, type FactOrigin, type UnknownReason } from "@/lib/evidence";

/**
 * Evidence ink: the one way to show a value about a property.
 *
 *   printed  published by the source            -> plain ink
 *   yours    typed by the buyer (an estimate)     -> indigo pencil, "yours"
 *   unknown  nobody has published it             -> amber hatch, same footprint
 *
 * "unknown" is never chosen by the caller: it is what happens when the value is
 * missing. So a gap can't be styled away, and a guess can't pass as a fact.
 */
export type { FactOrigin, FactFormat, UnknownReason } from "@/lib/evidence";

export function Fact({
  value,
  format = "text",
  origin = "printed",
  reason = "Not in the notice",
  className = "",
}: {
  value: unknown;
  format?: FactFormat;
  origin?: FactOrigin;
  reason?: UnknownReason;
  className?: string;
}) {
  const text = factText(value, format);
  if (text === null) {
    return (
      <span data-evidence="unknown" className={`ev-unknown inline-block text-[0.8em] font-semibold ${className}`}>
        <span className="sr-only">Unknown: </span>
        {reason}
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
    <span data-evidence="printed" className={`ev-printed ${className}`}>
      {text}
    </span>
  );
}

/** A small "yours" flag to sit next to buyer-typed inputs and results. */
export function YoursTag() {
  return (
    <span className="ml-1.5 inline-flex rounded-full bg-[var(--color-yours-wash)] px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wider text-[var(--color-yours)]">
      yours
    </span>
  );
}
