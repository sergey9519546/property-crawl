"use client";

import * as React from "react";
import { Bookmark } from "lucide-react";
import { useWorkspaceSession } from "@/components/workspace/workspace-shell";
import { useLocale } from "@/components/i18n/locale-provider";
import {
  readDeviceWatchlistIds,
  removeDeviceWatchlistId,
  resetWatchlistSyncSession,
  syncDeviceWatchlistToServer,
  toggleDeviceWatchlistId,
} from "@/lib/watchlist-sync";

// Shares the "perfectproperty:saved-listings" device-storage key and shape
// (JSON array of listing ids) with the /listings grid.
export function ListingWatchlistToggle({ listingId }: { listingId: string }) {
  const { locale } = useLocale();
  const session = useWorkspaceSession();
  const [saved, setSaved] = React.useState(false);
  const [savedCount, setSavedCount] = React.useState<number | null>(null);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!session.memberTools) {
      resetWatchlistSyncSession();
      const deviceIds = readDeviceWatchlistIds();
      setSaved(deviceIds.includes(listingId));
      setSavedCount(deviceIds.length);
      setError("");
      return;
    }
    let active = true;
    void syncDeviceWatchlistToServer()
      .then((result) => {
        if (active) {
          setSaved(result.ids.includes(listingId));
          setSavedCount(result.savedCount);
          setError("");
        }
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "Watchlist could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [listingId, session.memberTools]);

  async function toggle() {
    if (!session.memberTools) {
      const result = toggleDeviceWatchlistId(listingId, saved);
      if (!result.ok) {
        setError("Your browser is blocking saved properties, so the watchlist was not updated.");
        return;
      }
      resetWatchlistSyncSession();
      setSaved(result.saved);
      setSavedCount(result.ids.length);
      setError("");
      return;
    }
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/alerts", {
        method: saved ? "DELETE" : "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listingId }),
      });
      const data = await response.json();
      if (response.status === 401) {
        void session.refresh();
        session.requestUnlock();
      }
      if (!response.ok) throw new Error(data.error || "Watchlist could not be updated.");
      const nextSaved = !saved;
      if (!nextSaved) {
        removeDeviceWatchlistId(listingId);
      }
      setSaved(nextSaved);
      setSavedCount((prev) => (nextSaved ? (prev ?? 0) + 1 : Math.max(0, (prev ?? 1) - 1)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Watchlist could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-watchlist-count={savedCount ?? undefined}>
      <button
        type="button"
        disabled={busy}
        aria-pressed={saved ? "true" : "false"}
        onClick={() => void toggle()}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border border-line-strong px-4 py-3 text-sm font-semibold text-ink hover:border-ink hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 disabled:opacity-50"
      >
        <Bookmark className={`h-4 w-4 ${saved ? "fill-current" : ""}`} aria-hidden />
        {busy ? (locale === "hy" ? "Թարմացվում է…" : locale === "ru" ? "Обновление…" : "Updating watchlist…") : saved ? (locale === "hy" ? "Պահված է նախընտրածներում" : locale === "ru" ? "В избранном" : "Saved to watchlist") : (locale === "hy" ? "Պահել նախընտրածներում" : locale === "ru" ? "В избранное" : "Save to watchlist")}
      </button>
      {error ? <p role="status" className="mt-2 text-xs text-catch-ink">{error}</p> : null}
    </div>
  );
}
