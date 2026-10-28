import * as React from "react";
import { GsapReveal } from "./gsap-reveal";

/**
 * One heading style for every homepage section: a small step/eyebrow pill,
 * the headline, and one short paragraph. Keeps the page reading as one story.
 */
export function SectionHeading({
  eyebrow,
  title,
  children,
  align = "center",
  tone = "neutral",
}: {
  eyebrow: string;
  title: React.ReactNode;
  children?: React.ReactNode;
  align?: "center" | "left";
  tone?: "neutral" | "catch";
}) {
  const centered = align === "center";
  return (
    <GsapReveal className={centered ? "mx-auto max-w-[760px] text-center" : "max-w-[760px]"}>
      <p
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.12em] ${
          tone === "catch"
            ? "border-[var(--catch-border)] bg-[var(--catch-bg)] text-[var(--catch-ink)]"
            : "border-line bg-card text-ink-2"
        }`}
      >
        <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${tone === "catch" ? "bg-catch" : "bg-signature ring-1 ring-ink/20"}`} />
        {eyebrow}
      </p>
      <h2 className="mt-5 text-balance text-display font-semibold text-ink">
        {title}
      </h2>
      {children ? (
        <p className={`mt-4 text-pretty text-body text-ink-2 sm:text-lead ${centered ? "mx-auto max-w-[620px]" : "max-w-[620px]"}`}>
          {children}
        </p>
      ) : null}
    </GsapReveal>
  );
}
