"use client";

import * as React from "react";

type Health = {
  status?: string;
  dataMode?: string;
  documentReviewStore?: string;
};

/**
 * Honest runtime banner: demo inventory / file-only reviews are not a
 * production-durable PostgreSQL deployment. Dismissible per browser session.
 */
export function DataModeBanner() {
  // `undefined` = not yet loaded, `null` = the health probe FAILED. The two must
  // not collapse: a failed probe used to set health to null, and the
  // `!health` guard then removed the banner entirely — so a broken health check
  // deleted the very warning that exists to catch runtime-mode problems.
  const [health, setHealth] = React.useState<Health | null | undefined>(undefined);
  const [dismissed, setDismissed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void fetch("/api/health", { cache: "no-store", credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`health ${r.status}`))))
      .then((data: Health) => {
        if (!cancelled) setHealth(data);
      })
      .catch(() => {
        if (!cancelled) setHealth(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (dismissed || health === undefined) return null;

  if (health === null) {
    // Degraded, not dismissible into silence: we cannot confirm the runtime is
    // production, so say so rather than implying everything is fine.
    return (
      <div
        role="status"
        data-testid="data-mode-banner"
        className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-950"
      >
        <div className="mx-auto flex max-w-[1380px] items-start justify-between gap-4">
          <p className="leading-6">
            <strong className="font-semibold">Runtime mode unverified:</strong>{" "}
            the health check did not respond. Inventory and document storage may be
            running in demo/in-memory mode.
          </p>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="shrink-0 rounded border border-amber-300 px-2 py-1 text-xs font-medium"
          >
            Dismiss
          </button>
        </div>
      </div>
    );
  }

  if (health.dataMode !== "demo" && health.documentReviewStore !== "file") return null;

  const parts: string[] = [];
  if (health.dataMode === "demo") {
    parts.push("Demo/in-memory inventory (DATABASE_URL unset) — listings are seed + local live-store, not a shared production database.");
  }
  if (health.documentReviewStore === "file") {
    parts.push("Document reviews persist to a host-local file store; attach a volume or PostgreSQL for redeploy durability.");
  }

  return (
    <div
      role="status"
      data-testid="data-mode-banner"
      className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-950"
    >
      <div className="mx-auto flex max-w-[1380px] items-start justify-between gap-4">
        <p className="leading-6">
          <strong className="font-semibold">Runtime mode:</strong>{" "}
          {parts.join(" ")}
        </p>
        <button
          type="button"
          className="shrink-0 rounded border border-amber-300 px-2 py-0.5 text-xs font-semibold text-amber-900"
          onClick={() => setDismissed(true)}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
