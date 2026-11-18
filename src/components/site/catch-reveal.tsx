"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Check, ExternalLink, Eye, RefreshCw } from "lucide-react";
import { listingCatch } from "@/lib/listing-catch";
import { safeImageUrl } from "@/lib/listing-display";
import { getExactSourceListingUrl } from "@/lib/listing-links";
import { formatCountyDisplayName } from "@/lib/county-seo";
import { SOURCES } from "@/components/terminal/property-data";
import { Fact } from "@/components/evidence/fact";
import { sourceDisplayText } from "@/lib/source-display";
import { SectionHeading } from "./section-heading";
import { useLocale } from "@/components/i18n/locale-provider";
import { getPropertyPlaceholder } from "@/lib/property-placeholders";
import type { Messages } from "@/lib/i18n/messages";

type Listing = Parameters<typeof listingCatch>[0] & {
  id: string;
  address?: string | null;
  city?: string | null;
  county?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  photo?: string | null;
  propType?: string | null;
};

const SOURCE_NAMES: Record<string, string> = {
  bid4assets: "Online tax sale",
  civilview: "Sheriff sale",
  fannie: "Fannie Mae bank-owned",
  fdic: "FDIC bank-owned",
  freddie: "Freddie Mac bank-owned",
  gsa: "GSA federal sale",
  hud: "HUD home",
  irs: "IRS seizure",
  landbank: "Land bank",
  marshals: "US Marshals sale",
  servicelink: "Public auction",
  sheriff: "Sheriff sale",
  treasury: "Treasury seizure",
  trustee: "Trustee sale",
  usda: "USDA home",
  va: "VA home",
};

function getMitigationHeuristic(flag: string, m: Messages["home"]["catchReveal"]["mitigations"]): string | null {
  const lower = flag.toLowerCase();
  if (lower.includes("occupied") || lower.includes("eviction")) return m.occupied;
  if (lower.includes("redemption")) return m.redemption;
  if (lower.includes("senior-lien") || lower.includes("lien")) return m.lien;
  if (lower.includes("deposit") || lower.includes("certified")) return m.deposit;
  if (lower.includes("stale") || lower.includes("checked")) return m.stale;
  return null;
}

/**
 * The homepage's proof moment: a real, current listing shown the way a sale
 * posts it (price first), and then the catch our rules found in it.
 * Real data only. If listings can't load, it says so and links to search.
 */
export function CatchReveal() {
  const { locale, messages, plural } = useLocale();
  const cr = messages.home.catchReveal;
  const [listings, setListings] = React.useState<Listing[]>([]);
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");
  const [index, setIndex] = React.useState(0);
  const [revealed, setRevealed] = React.useState(false);
  const [showAerial, setShowAerial] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/listings?limit=12&maxBid=5000000", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { listings?: Listing[] }) => {
        if (cancelled) return;
        const rows = (data.listings ?? []).filter((l) => l?.id && l.address);
        setListings(rows);
        setStatus(rows.length ? "ready" : "error");
      })
      .catch(() => !cancelled && setStatus("error"));
    return () => {
      cancelled = true;
    };
  }, []);

  const listing = listings[index] ?? null;
  const exactSourceUrl = listing ? getExactSourceListingUrl(listing, SOURCES[String(listing.source)]?.websiteUrl) : null;
  const found = listing ? listingCatch(listing) : null;
  const photo = listing ? safeImageUrl(listing.photo) : undefined;
  const place = listing ? [listing.county ? formatCountyDisplayName(String(listing.county)) : null, listing.state].filter(Boolean).join(", ") : "";

  const next = () => {
    setRevealed(false);
    setIndex((i) => (listings.length ? (i + 1) % listings.length : 0));
  };

  return (
    <section id="the-catch" className="scroll-mt-24 px-5 pt-24 pb-28 lg:px-8">
      <div className="mx-auto max-w-[1080px]">
        <SectionHeading eyebrow={cr.eyebrow} tone="catch" title={cr.title}>
          {cr.subtitle}
        </SectionHeading>

        <div className="relative mt-12 grid gap-4 lg:grid-cols-2">
          {/* Left: what the sale posts */}
          <article className="overflow-hidden rounded-card border border-line bg-card shadow-raised">
            <div className="relative h-48 w-full overflow-hidden bg-paper">
              <div aria-hidden="true" className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url("${getPropertyPlaceholder(listing?.propType, { address: listing?.address, source: listing?.source }).imageSrc}")` }} />
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo} alt="" loading="lazy" referrerPolicy="no-referrer" className="relative h-full w-full object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }} />
              ) : showAerial && listing?.id ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/property-image?listingId=${encodeURIComponent(listing.id)}&mode=aerial`} alt={`Aerial parcel view for ${listing.address || ""}`} loading="lazy" className="relative h-full w-full object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }} />
              ) : null}
              <span className="absolute left-4 top-4 rounded-full bg-card/90 px-3 py-1 text-label font-semibold text-ink shadow-sm backdrop-blur">
                {photo ? cr.whatPostsBadge : showAerial ? `${cr.whatPostsBadge} · Aerial parcel view` : `${getPropertyPlaceholder(listing?.propType, { address: listing?.address, source: listing?.source }).typeLabel} · Placeholder`}
              </span>
              {!photo && !showAerial && listing?.id ? (
                <button
                  type="button"
                  onClick={() => setShowAerial(true)}
                  className="absolute bottom-3 right-3 rounded-control border border-line-strong bg-card/95 px-3 py-1.5 text-xs font-semibold text-ink shadow-sm backdrop-blur hover:bg-card"
                >
                  Aerial view
                </button>
              ) : null}
            </div>
            <div className="p-6 sm:p-7">
              {status === "loading" ? (
                <div aria-hidden className="space-y-3">
                  <div className="h-5 w-3/4 animate-pulse rounded bg-line" />
                  <div className="h-4 w-1/2 animate-pulse rounded bg-line" />
                  <div className="h-10 w-1/3 animate-pulse rounded bg-line" />
                </div>
              ) : listing ? (
                <>
                  <p className="text-label font-semibold uppercase tracking-wider text-ink-3">
                    {SOURCE_NAMES[String(listing.source)] ?? sourceDisplayText(String(listing.source ?? "Public sale"))}
                  </p>
                  <h3 className="mt-2 text-title font-semibold leading-snug text-ink">
                    <Link href={`/listings/${encodeURIComponent(listing.id)}`} className="hover:underline underline-offset-4">
                      {listing.address}
                    </Link>
                  </h3>
                  {place ? <p className="mt-1 text-meta text-ink-3">{place}</p> : null}
                  <div className="mt-6 flex items-end justify-between gap-4 border-t border-paper pt-5">
                    <div>
                      <p className="text-label font-medium text-ink-3">{cr.openingBid}</p>
                      <p className="text-title font-semibold tracking-tight text-ink tabular-nums"><Fact value={listing.openingBid} format="money" /></p>
                    </div>
                    <div className="text-right">
                      <p className="text-label font-medium text-ink-3">{cr.saleDate}</p>
                      <p className="text-meta font-semibold text-ink"><Fact value={listing.saleDate} format="date" /></p>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-body text-ink-2">
                  {cr.loadError}{" "}
                  <Link href="/listings" className="font-semibold text-ink underline underline-offset-4">{cr.searchInstead}</Link>.
                </p>
              )}
            </div>
          </article>

          {/* Right: the catch */}
          <article
            aria-live="polite"
            className={`relative flex flex-col rounded-card border p-6 transition-colors duration-300 sm:p-7 ${
              revealed ? "border-[var(--catch-border)] bg-[var(--catch-bg)]" : "border-dashed border-line-strong bg-card/60"
            }`}
          >
            <p className="inline-flex w-fit items-center gap-1.5 rounded-full bg-catch-wash px-3 py-1 text-label font-semibold text-[var(--catch-ink)]">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> {cr.theCatchBadge}
            </p>

            {!revealed ? (
              <div className="flex flex-1 flex-col items-start justify-center py-8">
                <p className="text-title font-semibold leading-snug text-ink">
                  {found ? plural(found.flags.length, cr.checksCount) : cr.defaultHeadline}
                </p>
                <p className="mt-2 max-w-[400px] text-body text-ink-3">
                  {cr.unshownSub}
                </p>
                <button
                  type="button"
                  disabled={!found}
                  onClick={() => setRevealed(true)}
                  className="mt-6 inline-flex h-11 items-center gap-2 rounded-control bg-ink px-5 text-meta font-semibold text-white transition-colors hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Eye className="h-4 w-4" aria-hidden /> {cr.showCatchBtn}
                </button>
              </div>
            ) : found ? (
              <div className="mt-5 flex-1">
                <ol className="space-y-3">
                  {found.flags.map((flag, i) => {
                    const mitigation = getMitigationHeuristic(flag, cr.mitigations);
                    return (
                      <li key={flag} className="catch-item flex flex-col gap-1.5" style={{ animationDelay: `${i * 70}ms` }}>
                        <div className="flex gap-3">
                          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-catch/15 text-label font-bold text-[var(--catch-ink)]">
                            {i + 1}
                          </span>
                          <span className="text-body text-catch-ink leading-snug">{flag}</span>
                        </div>
                        {mitigation ? (
                          <div className="ml-9 rounded-control border border-catch/20 bg-catch/5 px-2.5 py-1 text-label font-medium text-catch-ink/90">
                            {mitigation}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                  {found.notes.map((note, i) => (
                    <li key={note} className="catch-item flex gap-3" style={{ animationDelay: `${(found.flags.length + i) * 70}ms` }}>
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink/10">
                        <Check className="h-3.5 w-3.5 text-ink-2" aria-hidden />
                      </span>
                      <span className="text-body text-ink-2">{note}</span>
                    </li>
                  ))}
                </ol>
                <p className="mt-5 border-t border-catch/25 pt-4 text-label leading-5 text-catch-ink">
                  {locale === "en"
                    ? "Built only from what the listing publishes. Title, liens and condition still need your own check."
                    : cr.disclaimer}
                </p>
              </div>
            ) : null}
          </article>
        </div>

        {listing ? (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-meta font-semibold">
            <button type="button" onClick={next} className="inline-flex items-center gap-1.5 text-ink hover:underline underline-offset-4">
              <RefreshCw className="h-4 w-4" aria-hidden /> {cr.showAnother}
            </button>
            <Link href={`/listings/${encodeURIComponent(listing.id)}`} className="inline-flex items-center gap-1.5 text-ink hover:underline underline-offset-4">
              {cr.openFull} <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            {exactSourceUrl ? (
              <a href={exactSourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-ink-3 hover:text-ink">
                {cr.originalNotice} <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
