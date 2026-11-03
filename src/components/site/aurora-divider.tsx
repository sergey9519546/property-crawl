import type { ReactNode } from "react";

/**
 * Cadastral hairline divider with architectural survey coordinate markings.
 * Replaces blurry aurora gradient blobs with crisp evidence-first drafting lines.
 */
const SECTION_COORDINATES = [
  "SEC 01 // 39°45'N 104°59'W // DISCOVERY PROTOCOL",
  "SEC 02 // 41°53'N 087°38'W // FORENSIC CATCH REVEAL",
  "SEC 03 // 34°03'N 118°14'W // STATUTORY TRIAGE WORKFLOW",
  "SEC 04 // 29°58'N 090°04'W // LIVE AUCTION PIPELINE",
  "SEC 05 // 25°46'N 080°11'W // SECOND-LOOK RECONSIDERATION",
  "SEC 06 // 47°36'N 122°19'W // VERIFIED EVIDENCE AUDIT",
];

export function AuroraDivider({ index = 0 }: { index?: number }) {
  const coord = SECTION_COORDINATES[index % SECTION_COORDINATES.length];

  return (
    <div
      aria-hidden
      className="pointer-events-none relative mx-auto my-8 flex w-full max-w-7xl items-center px-5 lg:px-8"
    >
      <div className="h-[1px] flex-1 bg-line" />
      <div className="flex items-center gap-2 px-3 font-mono text-label tracking-widest text-ink-3 select-none">
        <span className="text-ink-3/50">+</span>
        <span className="hidden sm:inline">{coord}</span>
        <span className="sm:hidden">CAD // 0{index + 1}</span>
        <span className="text-ink-3/50">+</span>
      </div>
      <div className="h-[1px] flex-1 bg-line" />
    </div>
  );
}

export function AuroraBackground({ children }: { index?: number; children?: ReactNode }) {
  return (
    <div className="relative">
      <div className="relative z-10">{children}</div>
    </div>
  );
}
