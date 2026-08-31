"use client";

import * as React from "react";

/**
 * AuroraDivider — a subtle gradient mesh that breaks the page between sections.
 * Not a full color change, just a whisper of shifting color that creates
 * visual rhythm as you scroll. Very low opacity, very soft.
 *
 * Each instance picks a slightly different hue offset so the page feels alive
 * without being noisy.
 */

const PALETTES = [
  // Very subtle warm-white to cool-white
  { a: "rgba(245,246,247,0)", b: "rgba(238,241,245,0.4)", c: "rgba(245,246,247,0)" },
  // Whisper of lavender
  { a: "rgba(245,246,247,0)", b: "rgba(238,236,244,0.3)", c: "rgba(245,246,247,0)" },
  // Whisper of warm beige
  { a: "rgba(245,246,247,0)", b: "rgba(244,242,238,0.3)", c: "rgba(245,246,247,0)" },
  // Whisper of cool mint
  { a: "rgba(245,246,247,0)", b: "rgba(238,244,242,0.3)", c: "rgba(245,246,247,0)" },
  // Whisper of soft grey-blue
  { a: "rgba(245,246,247,0)", b: "rgba(236,240,245,0.35)", c: "rgba(245,246,247,0)" },
];

export function AuroraDivider({ index = 0 }: { index?: number }) {
  const palette = PALETTES[index % PALETTES.length];

  return (
    <div
      aria-hidden
      className="pointer-events-none relative h-[1px] w-full overflow-hidden"
    >
      {/* Soft gradient line — barely visible */}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(90deg, ${palette.a} 0%, ${palette.b} 50%, ${palette.c} 100%)`,
        }}
      />
      {/* Glow blob — very subtle, offset from center */}
      <div
        className="absolute left-1/2 top-1/2 h-[120px] w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background: `radial-gradient(ellipse, ${palette.b} 0%, transparent 70%)`,
          filter: "blur(40px)",
        }}
      />
    </div>
  );
}

/**
 * AuroraBackground — a full-section subtle mesh background.
 * Place inside a section to give it a whisper of color.
 */
export function AuroraBackground({ index = 0, children }: { index?: number; children?: React.ReactNode }) {
  const palette = PALETTES[index % PALETTES.length];

  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background: `radial-gradient(ellipse 80% 50% at 50% 50%, ${palette.b} 0%, transparent 70%)`,
          filter: "blur(60px)",
        }}
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
}
