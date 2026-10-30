"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Check, ExternalLink, Eye, House, RefreshCw } from "lucide-react";
import { listingCatch } from "@/lib/listing-catch";
import { safeImageUrl } from "@/lib/listing-display";
import { getExactSourceListingUrl } from "@/lib/listing-links";
import { SOURCES } from "@/components/terminal/property-data";
import { Fact } from "@/components/evidence/fact";
import { sourceDisplayText } from "@/lib/source-display";
import { SectionHeading } from "./section-heading";

type Listing = Parameters<typeof listingCatch>[0] & {
  id: string;
  address?: string | null;
  city?: string | null;
  county?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  photo?: string | null;
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

/**
 * The homepage's proof moment: a real, current listing shown the way a sale
 * posts it (price first), and then the catch our rules found in it.
 * Real data only. If listings can't load, it says so and links to search.
 */
export function CatchReveal() {
  const [listings, setListings] = React.useState<Listing[]>([]);
  const [status, setStatus] = React.useState<"loading" | "ready" | "error">("loading");
  const [index, setIndex] = React.useState(0);
  const [revealed, setRevealed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    // maxBid limits the sample to listings that publish an opening bid, so the
    // "price first" side always has a real price to show.
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
  const place = listing ? [listing.county ? `${String(listing.county).replace(/\s+county\s*$/i, "")} County` : null, listing.state].filter(Boolean).join(", ") : "";

  const next = () => {
    setRevealed(false);
    setIndex((i) => (listings.length ? (i + 1) % listings.length : 0));
  };

  return (
    <section id="the-catch" className="scroll-mt-24 px-5 pt-24 pb-28 lg:px-8">
      <div className="mx-auto max-w-[1080px]">
        <SectionHeading eyebrow="The catch" tone="catch" title={<>Every deal has a catch.<br className="hidden sm:block" /> We show it first.</>}>
          Auction listings lead with the price. We read the sale details and list what could cost you:
          who lives there, how long the owner can buy it back, the deposit, and anything the notice leaves out.
        </SectionHeading>

        <div className="relative mt-12 grid gap-4 lg:grid-cols-2">
          {/* Left: what the sale posts */}
          <article className="overflow-hidden rounded-3xl border border-line bg-card shadow-[0_1px_2px_rgba(24,21,41,0.04),0_18px_48px_rgba(24,21,41,0.06)]">
            <div className="relative h-44 bg-[linear-gradient(135deg,#f5f6f7,#e5e7eb)]">
              <House aria-hidden className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 text-ink-3/40" />
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo} alt="" loading="lazy" referrerPolicy="no-referrer" className="relative h-full w-full object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }} />
              ) : null}
              <span className="absolute left-4 top-4 rounded-full bg-card/90 px-3 py-1 text-[12px] font-semibold text-ink shadow-sm backdrop-blur">
                What the sale posts
              </span>
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
                  <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-3">
                    {SOURCE_NAMES[String(listing.source)] ?? sourceDisplayText(String(listing.source ?? "Public sale"))}
                  </p>
                  <h3 className="mt-2 text-[20px] font-semibold leading-snug text-ink">{listing.address}</h3>
                  {place ? <p className="mt-1 text-[14px] text-ink-3">{place}</p> : null}
                  <div className="mt-6 flex items-end justify-between gap-4 border-t border-paper pt-5">
                    <div>
                      <p className="text-[12px] font-medium text-ink-3">Opening bid</p>
                      <p className="text-[34px] font-semibold tracking-[-0.03em] text-ink tabular-nums"><Fact value={listing.openingBid} format="money" /></p>
                    </div>
                    <div className="text-right">
                      <p className="text-[12px] font-medium text-ink-3">Sale date</p>
                      <p className="text-[15px] font-semibold text-ink"><Fact value={listing.saleDate} format="date" /></p>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-[15px] leading-6 text-ink-2">
                  We couldn&apos;t load a listing just now.{" "}
                  <Link href="/listings" className="font-semibold text-ink underline underline-offset-4">Search listings instead</Link>.
                </p>
              )}
            </div>
          </article>

          {/* Right: the catch */}
          <article
            aria-live="polite"
            className={`relative flex flex-col rounded-3xl border p-6 transition-colors duration-300 sm:p-7 ${
              revealed ? "border-[var(--catch-border)] bg-[var(--catch-bg)]" : "border-dashed border-line-strong bg-card/60"
            }`}
          >
            <p className="inline-flex w-fit items-center gap-1.5 rounded-full bg-catch-wash px-3 py-1 text-[12px] font-semibold text-[var(--catch-ink)]">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> The catch
            </p>

            {!revealed ? (
              <div className="flex flex-1 flex-col items-start justify-center py-8">
                <p className="text-[22px] font-semibold leading-snug tracking-[-0.01em] text-ink">
                  {found ? `${found.flags.length} thing${found.flags.length === 1 ? "" : "s"} to check before you bid.` : "The price is only half the story."}
                </p>
                <p className="mt-2 max-w-[400px] text-[15px] leading-6 text-ink-3">
                  This is the part most listings leave for you to find out on sale day.
                </p>
                <button
                  type="button"
                  disabled={!found}
                  onClick={() => setRevealed(true)}
                  className="mt-6 inline-flex h-11 items-center gap-2 rounded-xl bg-ink px-5 text-[14px] font-semibold text-white transition-colors hover:bg-ink-2 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Eye className="h-4 w-4" aria-hidden /> Show the catch
                </button>
              </div>
            ) : found ? (
              <div className="mt-5 flex-1">
                <ol className="space-y-3">
                  {found.flags.map((flag, i) => (
                    <li key={flag} className="catch-item flex gap-3" style={{ animationDelay: `${i * 70}ms` }}>
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-catch/15 text-[12px] font-bold text-[var(--catch-ink)]">
                        {i + 1}
                      </span>
                      <span className="text-[15px] leading-6 text-catch-ink">{flag}</span>
                    </li>
                  ))}
                  {found.notes.map((note, i) => (
                    <li key={note} className="catch-item flex gap-3" style={{ animationDelay: `${(found.flags.length + i) * 70}ms` }}>
                      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink/10">
                        <Check className="h-3.5 w-3.5 text-ink-2" aria-hidden />
                      </span>
                      <span className="text-[15px] leading-6 text-ink-2">{note}</span>
                    </li>
                  ))}
                </ol>
                <p className="mt-5 border-t border-catch/25 pt-4 text-[13px] leading-5 text-catch-ink">
                  Built only from what the listing publishes. Title, liens and condition still need your own check.
                </p>
              </div>
            ) : null}
          </article>
        </div>

        {listing ? (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-[14px] font-semibold">
            <button type="button" onClick={next} className="inline-flex items-center gap-1.5 text-ink hover:underline underline-offset-4">
              <RefreshCw className="h-4 w-4" aria-hidden /> Show another listing
            </button>
            <Link href={`/listings/${encodeURIComponent(listing.id)}`} className="inline-flex items-center gap-1.5 text-ink hover:underline underline-offset-4">
              Open the full listing <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            {exactSourceUrl ? (
              <a href={exactSourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-ink-3 hover:text-ink">
                Original notice <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
