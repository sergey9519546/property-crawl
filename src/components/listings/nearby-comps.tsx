"use client";

import * as React from "react";
import Link from "next/link";
import { Building2, MapPin, ExternalLink, Loader2, Compass } from "lucide-react";
import { getWatchlistComps, type WatchlistCompsResponse, type WatchlistCompItem } from "@/lib/intelligence-client";
import { sourceDisplayText } from "@/lib/source-display";
import { bandForScore } from "@/lib/score-bands";

interface NearbyCompsProps {
  listingId: string;
  targetAddress?: string;
  targetSqft?: number | null;
  targetOpeningBid?: number | null;
}

function formatMoney(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return "Not published";
  return `$${Math.round(amount).toLocaleString()}`;
}

export function NearbyComps({
  listingId,
  targetAddress,
  targetSqft,
  targetOpeningBid,
}: NearbyCompsProps) {
  const [data, setData] = React.useState<WatchlistCompsResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    getWatchlistComps(listingId, { radiusKm: 8, sqftBand: 0.3, limit: 6 })
      .then((res) => {
        if (!active) return;
        setData(res);
        setLoading(false);
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Failed to load comparable properties");
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [listingId]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-line bg-card p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <Loader2 className="h-4 w-4 animate-spin text-ink-3" />
          <p className="text-xs font-medium text-ink-3">Searching active comps within 8 km...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return null; // Fail-soft if endpoint unavailable or errored
  }

  const comps = Array.isArray(data.comps) ? data.comps : [];

  return (
    <div className="rounded-2xl border border-line bg-card p-6 shadow-sm sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
        <div>
          <h2 className="text-base font-bold text-ink flex items-center gap-2">
            <Compass className="h-4 w-4 text-ink-3" />
            Nearby Comparable Auctions & Filings
          </h2>
          <p className="mt-1 text-xs text-ink-3">
            Active distressed listings within 8 km with ±30% interior area matching {targetAddress || "this subject"}.
          </p>
        </div>
        {comps.length > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="rounded-lg bg-paper px-2.5 py-1 font-bold text-ink border border-line">
              {comps.length} {comps.length === 1 ? "comp" : "comps"} found
            </span>
            {data.stats.medianOpeningBid !== null && (
              <span className="rounded-lg bg-line px-2.5 py-1 font-medium text-ink-2">
                Median: {formatMoney(data.stats.medianOpeningBid)}
              </span>
            )}
          </div>
        )}
      </div>

      {comps.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-line bg-paper p-6 text-center">
          <p className="text-xs text-ink-3">
            No active distressed comparables observed within an 8 km radius matching the size profile.
          </p>
          <p className="mt-1 text-[11px] text-ink-3">
            Comps update continuously as county sheriff and foreclosure dockets are ingested.
          </p>
        </div>
      ) : (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {comps.map((comp) => {
            const id = comp.id || comp.listing?.id;
            const address = comp.address || comp.listing?.address || "Address not published";
            const city = comp.city || comp.listing?.city;
            const state = comp.state || comp.listing?.state;
            const openingBid = comp.openingBid ?? comp.listing?.openingBid;
            const dealScore = comp.dealScore ?? comp.listing?.dealScore;
            const sqft = comp.sqft ?? comp.listing?.sqft;
            const distance = typeof comp.distanceKm === "number" ? `${comp.distanceKm.toFixed(1)} km` : null;

            if (!id) return null;

            return (
              <Link
                key={id}
                href={`/listings/${encodeURIComponent(id)}`}
                className="group flex flex-col justify-between rounded-xl border border-line bg-paper p-4 transition hover:border-line-strong hover:bg-card hover:shadow-md"
              >
                <div>
                  <div className="flex items-center justify-between text-xs font-semibold text-ink-3">
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3 text-ink-3" />
                      {distance ? `${distance} away` : "Nearby"}
                    </span>
                    {dealScore != null && (
                      <span className="rounded bg-line px-1.5 py-0.5 text-[10px] font-bold text-ink" style={{ color: bandForScore(dealScore)?.color }}>
                        Score {Math.round(dealScore)}
                      </span>
                    )}
                  </div>
                  <h3 className="mt-2 text-xs font-bold text-ink group-hover:text-ink-2 transition-colors line-clamp-2">
                    {address}
                  </h3>
                  {city && state && (
                    <p className="text-[11px] text-ink-3 mt-0.5">{city}, {state}</p>
                  )}
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-line pt-3 text-xs">
                  <div>
                    <span className="block text-[10px] text-ink-3 uppercase font-medium">Opening Amount</span>
                    <span className="font-bold text-ink">{formatMoney(openingBid)}</span>
                  </div>
                  {sqft != null && sqft > 0 && (
                    <div className="text-right">
                      <span className="block text-[10px] text-ink-3 uppercase font-medium">Area</span>
                      <span className="font-semibold text-ink-2">{sqft.toLocaleString()} sq ft</span>
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
