"use client";

import { useLocale } from "@/components/i18n/locale-provider";
import { getPropertyPlaceholder } from "@/lib/property-placeholders";

type PropertyEvidenceVisualProps = {
  listingId?: string | null;
  address: string;
  propType?: string | null;
  compact?: boolean;
  className?: string;
  statusLabel?: string;
};

function stableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function addressLines(address: string, emptyFallback: string) {
  const clean = address.replace(/\s+/g, " ").trim() || emptyFallback;
  if (clean.length <= 44) return [clean];

  const splitCandidates = [clean.lastIndexOf(",", 44), clean.lastIndexOf(" ", 44)];
  const splitAt = Math.max(...splitCandidates);
  if (splitAt < 16) return [`${clean.slice(0, 42).trim()}…`, clean.slice(42, 84).trim()];
  const secondLine = clean.slice(splitAt + 1).trim();
  return [clean.slice(0, splitAt).trim(), secondLine.length > 44 ? `${secondLine.slice(0, 42).trim()}…` : secondLine];
}

/**
 * A deterministic property-type architectural placeholder diagram used only when
 * no verified property photo is available. Its illustrative rendering and
 * permanent in-art disclosure prevent it from being read as an observed photo.
 */
export function PropertyEvidenceVisual({
  listingId,
  address,
  propType,
  compact = false,
  className = "",
  statusLabel,
}: PropertyEvidenceVisualProps) {
  const { messages, format } = useLocale();
  const t = messages.mediaUi;
  const seed = stableHash(`${listingId || "unresolved"}|${address.toLowerCase()}`);
  const lines = addressLines(address, t.addressUnderReview);
  const recordSuffix = (listingId || seed.toString(16).toUpperCase()).replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase() || "PENDING";
  const placeholder = getPropertyPlaceholder(propType);

  return (
    <div
      role="img"
      aria-label={`${placeholder.alt} · ${address}`}
      data-testid="property-evidence-visual"
      data-placeholder-category={placeholder.category}
      className={`relative isolate flex h-full w-full flex-col justify-between overflow-hidden bg-paper ${className}`}
    >
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-cover bg-center opacity-95"
        style={{ backgroundImage: `url("${placeholder.imageSrc}")` }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-b from-ink/25 via-transparent to-ink/85"
      />

      <div className="relative z-10 flex flex-wrap items-start justify-between gap-2 p-4 sm:p-6">
        <span className="inline-flex items-center gap-2 rounded-control border border-line-strong bg-card/95 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-ink shadow-sm backdrop-blur">
          <span className="h-2 w-2 rounded-full bg-catch" aria-hidden="true" />
          {placeholder.typeLabel} placeholder
        </span>
        <div className="rounded-control bg-ink/85 px-3 py-1.5 text-right text-paper shadow-sm backdrop-blur">
          <p className="text-label font-bold uppercase tracking-wider">{t.svgNotPhoto}</p>
          <p className="text-label text-paper/75">{format(t.svgRecord, { suffix: recordSuffix })}</p>
        </div>
      </div>

      <div className="relative z-10 mt-auto border-t border-paper/15 bg-ink/88 px-4 py-3.5 text-paper backdrop-blur-sm sm:px-6 sm:py-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-label font-bold uppercase tracking-wider text-paper/80">
          <span>{t.svgPhotoPending}</span>
          <span>{format(t.svgEvidenceCanvas, { status: statusLabel?.toUpperCase() || t.svgSourceMediaOpen })}</span>
        </div>
        <p className={`mt-1.5 font-bold leading-snug text-paper ${compact ? "text-sm" : "text-base sm:text-lg"}`}>
          {lines.join(" · ")}
        </p>
        {!compact ? <p className="mt-1 text-xs text-paper/75">{t.svgParcelIllustrative}</p> : null}
      </div>
    </div>
  );
}
