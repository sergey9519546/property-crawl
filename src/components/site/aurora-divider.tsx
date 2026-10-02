import type { ReactNode } from "react";

/**
 * AuroraDivider — a subtle gradient mesh that breaks the page between sections.
 * Not a full color change, just a whisper of shifting color that creates
 * visual rhythm as you scroll. Very low opacity, very soft.
 *
 * Each instance picks a slightly different hue offset so the page feels alive
 * without being noisy.
 *
 * Deliberately NOT a client component. It renders a static gradient with no
 * hooks, no state and no event handlers, so there is nothing for hydration to
 * do — yet the landing page mounts twelve of them, and every "use client" here
 * was twelve client boundaries and their JS for zero interactivity.
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

/**
 * Scale an rgba() alpha so a gradient can carry intermediate stops.
 * Hand-rolled rather than color-mix(), which landed in Firefox 113 and so sits
 * below this project's Firefox 111 Baseline floor.
 * "rgba(238,241,245,0.4)" at 0.45 -> "rgba(238, 241, 245, 0.18)".
 */
function fade(rgba: string, factor: number): string {
  return rgba.replace(/rgba?\(([^)]+)\)/, (_match, body: string) => {
    const parts = body.split(",").map((part) => part.trim());
    parts[3] = String(Number((Number(parts[3] ?? "1") * factor).toFixed(4)));
    return `rgba(${parts.join(", ")})`;
  });
}

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
      {/* Glow blob — very subtle, offset from center.
          The blur(40px) is baked into the gradient rather than applied as a
          filter. The old version filtered a 400px-wide radial gradient, which
          smeared it across roughly a 2σ ≈ 80px margin either side, so the box
          is widened to 560px to hold that footprint — the ramp then reaches
          zero inside the element instead of being clipped at the old edge, and
          the lower stops carry the softened shoulder the blur used to produce.
          Only the centre 1px of this blob is ever visible (the wrapper is
          h-[1px] overflow-hidden), and the box is absolutely positioned, so
          the wider box cannot move anything. */}
      <div
        className="absolute left-1/2 top-1/2 h-[120px] w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background: `radial-gradient(ellipse 280px 400px at 50% 50%, ${palette.b} 0%, ${fade(palette.b, 0.45)} 55%, ${fade(palette.b, 0.13)} 85%, ${fade(palette.b, 0.04)} 95%, transparent 100%)`,
        }}
      />
    </div>
  );
}

/**
 * AuroraBackground — a full-section subtle mesh background.
 * Place inside a section to give it a whisper of color.
 */
export function AuroraBackground({ index = 0, children }: { index?: number; children?: ReactNode }) {
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
