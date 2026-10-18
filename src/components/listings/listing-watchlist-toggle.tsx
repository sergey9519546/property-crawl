"use client";

import * as React from "react";
import { Bookmark } from "lucide-react";
import { useWorkspaceSession } from "@/components/workspace/workspace-shell";

export function ListingWatchlistToggle({ listingId }: { listingId: string }) {
  const session = useWorkspaceSession();
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!session.authenticated) {
      setSaved(false);
      setError("");
      return;
    }
    let active = true;
    void fetch("/api/alerts", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Watchlist could not be loaded.");
        const ids = Array.isArray(data.deals)
          ? data.deals.map((deal: unknown) =>
              typeof deal === "string"
                ? deal
                : (deal as { listingId?: string; id?: string })?.listingId || (deal as { listingId?: string; id?: string })?.id
            )
          : [];
        if (active) {
          setSaved(ids.includes(listingId));
          setError("");
        }
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "Watchlist could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [listingId, session.authenticated]);

  async function toggle() {
    if (!session.authenticated) {
      session.requestUnlock();
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
      setSaved(!saved);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Watchlist could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        disabled={busy}
        aria-pressed={saved ? "true" : "false"}
        onClick={() => void toggle()}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-900 hover:border-slate-900 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 disabled:opacity-50"
      >
        <Bookmark className={`h-4 w-4 ${saved ? "fill-current" : ""}`} aria-hidden />
        {busy ? "Updating watchlist…" : saved ? "Saved to watchlist" : "Save to watchlist"}
      </button>
      {error ? <p role="status" className="mt-2 text-xs text-red-700">{error}</p> : null}
    </div>
  );
}
