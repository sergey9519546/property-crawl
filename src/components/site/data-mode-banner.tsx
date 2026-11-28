"use client";

import * as React from "react";
import { fetchHealthSnapshot } from "@/lib/health-client";
import { useLocale } from "@/components/i18n/locale-provider";

type InventoryFreshness = {
  listings?: number | null;
  freshListings?: number | null;
  ageHours?: number | null;
  stale?: boolean;
  staleAfterHours?: number;
  staleBecause?: string | null;
  newestObservation?: string | null;
};

type Health = {
  status?: string;
  dataMode?: string;
  documentReviewStore?: string;
  inventoryUnavailableReason?: string;
  inventoryFreshness?: InventoryFreshness;
};

/**
 * Honest runtime banner: an unavailable database means there is no inventory to
 * serve, and file-only reviews are not a production-durable deployment.
 */
export function DataModeBanner() {
  const { locale, messages, format } = useLocale();
  const dm = messages.workspace.dataModeBanner;
  // `undefined` = not yet loaded, `null` = the health probe FAILED. The two must
  // not collapse: a failed probe used to set health to null, and the
  // `!health` guard then removed the banner entirely — so a broken health check
  // deleted the very warning that exists to catch runtime-mode problems.
  const [health, setHealth] = React.useState<Health | null | undefined>(undefined);
  const [dismissed, setDismissed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void fetchHealthSnapshot()
      .then((data) => {
        if (!cancelled) setHealth(data as Health);
      })
      .catch(() => {
        if (!cancelled) setHealth(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (dismissed) return null;

  // Reserve the banner's box while the health probe is still in flight.
  //
  // It used to return null here and then render once the fetch resolved, which
  // pushed the entire page down by the banner's own height -- 65px on
  // /listings, measured as a 0.043 layout shift and the second largest on that
  // route. A warning banner that arrives by shoving the content down is worse
  // than one that was always there.
  //
  // The text is honest about what it is doing and uses the same box, so the
  // height is identical whether the probe answers "demo" or "all clear". A
  // distinct testid keeps this pending state separate from the real banner, so
  // the honesty guard in test/honest-empty-state.test.js cannot mistake one for
  // the other.
  if (health === undefined) {
    return (
      <div
        role="status"
        data-testid="data-mode-banner-pending"
        className="border-b border-line-strong bg-paper px-4 py-1.5 text-sm text-ink-2"
      >
        {/* Same reserved box as the real banner. A one-line placeholder against
            a two-line real message still moved the page 24px, because the
            banner copy wraps at desktop widths. Both states therefore
            claim two lines up front, so the answer to the probe can change the
            words without changing the geometry. */}
        <div className="mx-auto flex min-h-[65px] max-w-[1380px] items-center justify-between gap-4">
          <p className="leading-6">{locale === "en" ? "Checking for the latest listings…" : dm.checking}</p>
        </div>
      </div>
    );
  }

  if (health === null) {
    // Degraded, not dismissible into silence: we cannot confirm the runtime is
    // production, so say so rather than implying everything is fine.
    return (
      <div
        role="status"
        data-testid="data-mode-banner"
        className="border-b border-catch/30 bg-catch-wash px-4 py-1.5 text-sm text-catch-ink"
      >
        <div className="mx-auto flex min-h-[65px] max-w-[1380px] items-center justify-between gap-4">
          <p className="leading-6">
            <strong className="font-semibold">{dm.failedTitle}</strong>{" "}
            {dm.failedBody}

          </p>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            aria-label={dm.dismissAria}
            className="shrink-0 rounded border border-catch/30 px-2 py-1 text-xs font-medium"
          >
            {dm.dismissBtn}
          </button>
        </div>
      </div>
    );
  }

  // `stale` is decided by the API, not recomputed here: the browser has no
  // trustworthy clock for "when did we last collect", and guessing it in the UI
  // is how a stale inventory ends up presented as current.
  const freshness = health.inventoryFreshness;
  const stale = Boolean(freshness?.stale) && typeof freshness?.ageHours === "number";

  // Where reviews are stored (health.documentReviewStore) is a staff matter, not shown to buyers.
  if (health.dataMode !== "unavailable" && !stale) return null;

  const parts: string[] = [];
  if (health.dataMode === "unavailable") {
    // Not dismissible: there is no inventory behind this page. A warning the
    // user can wave away would leave an empty result looking like a finding.
    // The internal reason (health.inventoryUnavailableReason) is never shown to buyers.
    parts.push(dm.unavailableBody);
  } else if (stale) {
    // A database full of rows is not the same claim as an inventory somebody
    // checked today. "Active" on a record nobody has re-observed in three weeks
    // is the exact thing a buyer is relying on and cannot check for themselves.
    //
    // Say how much is stale, not how fresh the newest row is. Collection is
    // bounded, so a fresh sweep makes the newest record minutes old while the
    // rest is untouched - "last observed 0 hours ago" would be true and useless.
    parts.push(format(dm.staleBody, { hours: freshness?.staleAfterHours ?? 24 }));
  }
  return (
    <div
      role="status"
      data-testid="data-mode-banner"
      className={
        health.dataMode === "unavailable"
          ? "border-b border-line-strong bg-paper px-4 py-1.5 text-sm text-ink-2"
          : "border-b border-catch/30 bg-catch-wash px-4 py-1.5 text-sm text-catch-ink"
      }
    >
      <div className="mx-auto flex min-h-[65px] max-w-[1380px] items-center justify-between gap-4">
        <p className="leading-6">
          {/* Localized equivalent of "Listings may be out of date:" */}
          <strong className="font-semibold">
            {health.dataMode === "unavailable" ? dm.unavailableTitle : dm.staleTitle}
          </strong>{" "}
          {parts.join(" ")}
        </p>
      </div>
    </div>
  );
}
