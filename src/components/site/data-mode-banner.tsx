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
  const [health, setHealth] = React.useState<Health | null>(null);
  const [dismissed, setDismissed] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void fetch("/api/health", { cache: "no-store", credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Health | null) => {
        if (!cancelled) setHealth(data);
      })
      .catch(() => {
        if (!cancelled) setHealth(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (dismissed || !health) return null;
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
