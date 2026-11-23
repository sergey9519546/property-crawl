"use client";

import * as React from "react";
import { KeyRound, ShieldCheck, Database, Activity, Server, Camera, Play } from "lucide-react";
import { useWorkspaceSession } from "@/components/workspace/workspace-shell";
import { useLocale } from "@/components/i18n/locale-provider";
import { formatLocaleNumber, interpolate } from "@/lib/i18n/translator";

type ReadyData = {
  ready?: boolean;
  mode?: string;
  failedChecks?: string[];
  checks?: Record<string, { ok?: boolean; detail?: string }>;
};

type ScraperHealthData = {
  systemStatus?: string;
  scrapersInFault?: number;
  scrapersWithDrift?: number;
  totalScrapers?: number;
  scrapers?: Array<{ name?: string; key?: string; status?: string; driftDetected?: boolean }>;
};

type ImageProviderEntry = {
  id: string;
  label?: string;
  role?: string;
  keyEnvVar?: string | null;
  requiresKey?: boolean;
  keyConfigured?: boolean;
  circuit?: {
    available?: boolean;
    failures?: number;
    openedUntil?: string | null;
    retryAfterSeconds?: number | null;
  };
  cache?: { entries?: number; hits?: number; misses?: number } | null;
};

type ImageProvidersResponse = {
  schema?: string;
  summary?: {
    total?: number;
    available?: number;
    missingKey?: number;
    circuitOpen?: number;
  };
  providers?: ImageProviderEntry[];
};

export function WorkspaceSettingsView() {
  const { locale, messages } = useLocale();
  const t = messages.settingsB2;
  const session = useWorkspaceSession();
  const [healthData, setHealthData] = React.useState<{
    status?: string;
    dataMode?: string;
    postgresReachable?: boolean;
    inventoryFreshness?: { stale?: boolean };
  } | null>(null);
  const [readyData, setReadyData] = React.useState<ReadyData | null>(null);
  const [readyStatusCode, setReadyStatusCode] = React.useState<number | null>(null);
  const [scraperHealth, setScraperHealth] = React.useState<ScraperHealthData | null>(null);
  const [scraperStatusCode, setScraperStatusCode] = React.useState<number | null>(null);
  const [scraperTelemetry, setScraperTelemetry] = React.useState<ScraperHealthData | null>(null);
  const [scraperTelemetryStatus, setScraperTelemetryStatus] = React.useState<number | null>(null);
  const [triggerBusy, setTriggerBusy] = React.useState(false);
  const [triggerMessage, setTriggerMessage] = React.useState<string | null>(null);
  const [imageProviders, setImageProviders] = React.useState<ImageProvidersResponse | null>(null);
  const [imageProvidersStatus, setImageProvidersStatus] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState(true);

  const loadAll = React.useCallback(async (isActive: () => boolean = () => true) => {
    const [healthRes, readyRes, scraperRes, scrapersSummaryRes, providersRes] = await Promise.allSettled([
      fetch("/api/health", { cache: "no-store" }),
      fetch("/api/health/ready", { cache: "no-store" }),
      fetch("/api/scrapers/health", { cache: "no-store" }),
      fetch("/api/scrapers", { cache: "no-store" }),
      fetch("/api/property-image/providers", { cache: "no-store" }),
    ]);
    if (!isActive()) return;

    if (healthRes.status === "fulfilled") {
      const data = await healthRes.value.json().catch(() => null);
      if (isActive() && data) setHealthData(data);
    }

    if (readyRes.status === "fulfilled") {
      setReadyStatusCode(readyRes.value.status);
      const data = await readyRes.value.json().catch(() => null);
      if (isActive() && data) setReadyData(data);
    }

    if (scraperRes.status === "fulfilled") {
      setScraperStatusCode(scraperRes.value.status);
      if (scraperRes.value.ok) {
        const data = await scraperRes.value.json().catch(() => null);
        if (isActive() && data) setScraperHealth(data);
      }
    }

    if (scrapersSummaryRes.status === "fulfilled") {
      setScraperTelemetryStatus(scrapersSummaryRes.value.status);
      if (scrapersSummaryRes.value.ok) {
        const data = await scrapersSummaryRes.value.json().catch(() => null);
        if (isActive() && data) setScraperTelemetry(data);
      }
    }

    if (providersRes.status === "fulfilled") {
      setImageProvidersStatus(providersRes.value.status);
      if (providersRes.value.ok) {
        const data = await providersRes.value.json().catch(() => null);
        if (isActive() && data) setImageProviders(data);
      }
    }

    if (isActive()) setLoading(false);
  }, []);

  React.useEffect(() => {
    let active = true;
    void loadAll(() => active);
    return () => {
      active = false;
    };
  }, [session.authenticated, loadAll]);

  const handleRunScrapers = React.useCallback(async () => {
    if (!session.authenticated) {
      session.requestUnlock();
      return;
    }
    setTriggerBusy(true);
    setTriggerMessage(null);
    try {
      const res = await fetch("/api/scrapers", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "next-slice", trigger: "workspace-settings" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setTriggerMessage(data?.error || interpolate(t.errScraperRejected, { status: res.status }));
      } else {
        setTriggerMessage(
          interpolate(t.msgScraperAccepted, {
            ranPart: typeof data?.ran === "number" ? interpolate(t.ranCountPart, { count: data.ran }) : "",
          }),
        );
        await loadAll();
      }
    } catch (err) {
      setTriggerMessage(err instanceof Error ? err.message : t.errTrigger);
    } finally {
      setTriggerBusy(false);
    }
  }, [session, loadAll, t.errScraperRejected, t.errTrigger, t.msgScraperAccepted, t.ranCountPart]);

  const scraperSummaryList = React.useMemo(() => {
    const source = Array.isArray(scraperHealth?.scrapers)
      ? scraperHealth.scrapers
      : Array.isArray(scraperTelemetry?.scrapers)
        ? scraperTelemetry.scrapers
        : [];
    return source.slice(0, 8);
  }, [scraperHealth, scraperTelemetry]);

  const activeScraperStats = scraperHealth || scraperTelemetry;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          {t.heading}
        </h1>
        <p className="mt-1 text-sm text-ink-3">
          {t.subtitle}
        </p>
      </div>

      <div className="space-y-6">
        {/* Session Card */}
        <div className="rounded-card border border-line bg-card p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-control bg-go-wash text-go">
              <KeyRound className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h2 className="text-base font-semibold text-ink">{t.sessionTitle}</h2>
              <p className="text-xs text-ink-3">{t.sessionSubtitle}</p>
            </div>
          </div>

          <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3 text-sm">
            <div className="rounded-control bg-paper p-4">
              <dt className="text-xs font-medium text-ink-3 uppercase tracking-wider">{t.statusLabel}</dt>
              <dd className="mt-1 font-semibold text-ink">
                {session.authenticated ? t.statusAuth : session.configured ? t.statusLocked : t.statusUnconf}
              </dd>
            </div>
            <div className="rounded-control bg-paper p-4">
              <dt className="text-xs font-medium text-ink-3 uppercase tracking-wider">{t.roleLabel}</dt>
              <dd className="mt-1 font-semibold text-ink">
                {session.authenticated
                  ? (session.role === "analyst" ? t.roleAnalyst : session.role === "viewer" ? t.roleViewer : t.roleOperator)
                  : session.member?.entitled
                    ? t.roleMemberEntitled
                    : session.member
                      ? t.roleMember
                      : t.roleViewer}
              </dd>
            </div>
            <div className="rounded-control bg-paper p-4">
              <dt className="text-xs font-medium text-ink-3 uppercase tracking-wider">{t.permsLabel}</dt>
              <dd className="mt-1 font-semibold text-ink">
                {session.authenticated
                  ? (session.role === "operator"
                      ? t.permFull
                      : session.role === "analyst"
                        ? t.permAnalyst
                        : t.permReadOnlyWs)
                  : t.permReadOnlyDisc}
              </dd>
            </div>
          </dl>
        </div>

        {/* Persistence & Readiness Card */}
        <div className="rounded-card border border-line bg-card p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-control bg-yours-wash text-yours">
              <Database className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h2 className="text-base font-semibold text-ink">{t.persistenceTitle || <>Persistence &amp; Discovery Readiness</>}</h2>
              <p className="text-xs text-ink-3">{t.persistenceSubtitle}</p>
            </div>
          </div>

          <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3 text-sm">
            <div className="rounded-control bg-paper p-4">
              <dt className="text-xs font-medium text-ink-3 uppercase tracking-wider">{t.invModeLabel}</dt>
              <dd className="mt-1 font-semibold text-ink">
                {loading ? t.checking : healthData?.dataMode || t.unknown}
              </dd>
            </div>
            <div className="rounded-control bg-paper p-4">
              <dt className="text-xs font-medium text-ink-3 uppercase tracking-wider">{t.pgReachableLabel}</dt>
              <dd className="mt-1 font-semibold text-ink">
                {loading ? t.checking : healthData?.postgresReachable ? t.yes : t.no}
              </dd>
            </div>
            <div className="rounded-control bg-paper p-4">
              <dt className="text-xs font-medium text-ink-3 uppercase tracking-wider">{t.probeLabel}</dt>
              <dd className="mt-1 font-semibold text-ink">
                {loading
                  ? t.checking
                  : readyData?.ready
                    ? interpolate(t.readyStatus, { status: readyStatusCode ?? 200 })
                    : readyStatusCode === 401
                      ? t.probeLocked
                      : interpolate(t.notReadyStatus, { status: readyStatusCode ?? t.na })}
              </dd>
            </div>
          </dl>

          {readyData?.failedChecks && readyData.failedChecks.length > 0 ? (
            <div className="mt-4 rounded-control border border-catch/30 bg-catch-wash p-3 text-xs text-catch-ink">
              <strong>{t.failedChecksPrefix}</strong> {readyData.failedChecks.join(", ")}
            </div>
          ) : null}
        </div>

        {/* Scraper Fleet Health & Trigger Card */}
        <div className="rounded-card border border-line bg-card p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-control bg-paper text-ink-2">
                <Activity className="h-5 w-5" aria-hidden />
              </div>
              <div>
                <h2 className="text-base font-semibold text-ink">{t.fleetTitle || <>Scraper Fleet &amp; Drift Health</>}</h2>
                <p className="text-xs text-ink-3">{t.fleetSubtitle}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {scraperStatusCode === 401 && !session.authenticated ? (
                <button
                  type="button"
                  onClick={() => session.requestUnlock()}
                  className="rounded-control border border-line-strong bg-card px-3 py-1.5 text-xs font-semibold text-ink hover:bg-paper"
                >
                  {t.unlockDiagBtn || "Unlock to view diagnostics"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void handleRunScrapers()}
                disabled={triggerBusy}
                className="inline-flex items-center gap-1.5 rounded-control bg-ink px-3 py-1.5 text-xs font-semibold text-white hover:bg-ink-2 disabled:opacity-60"
              >
                <Play className="h-3.5 w-3.5" aria-hidden />
                {triggerBusy
                  ? t.runningScrapersBtn
                  : session.authenticated
                    ? t.runScrapersBtn
                    : t.unlockRunScrapersBtn}
              </button>
            </div>
          </div>

          {triggerMessage ? (
            <p className="mt-3 rounded-control border border-line bg-paper px-3 py-2 text-xs text-ink-2">
              {triggerMessage}
            </p>
          ) : null}

          <dl className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-4 text-sm">
            <div className="rounded-control bg-paper p-4">
              <dt className="text-xs font-medium text-ink-3 uppercase tracking-wider">{t.fleetStatusLabel}</dt>
              <dd className="mt-1 font-semibold text-ink">
                {loading
                  ? t.checking
                  : activeScraperStats?.systemStatus || (scraperStatusCode ? interpolate(t.gatedStatus, { status: scraperStatusCode }) : scraperTelemetryStatus ? interpolate(t.httpStatus, { status: scraperTelemetryStatus }) : t.unavailable)}
              </dd>
            </div>
            <div className="rounded-control bg-paper p-4">
              <dt className="text-xs font-medium text-ink-3 uppercase tracking-wider">{t.totalScrapersLabel}</dt>
              <dd className="mt-1 font-semibold text-ink tabular-nums">
                {activeScraperStats?.totalScrapers !== undefined ? formatLocaleNumber(locale, activeScraperStats.totalScrapers) : "—"}
              </dd>
            </div>
            <div className="rounded-control bg-paper p-4">
              <dt className="text-xs font-medium text-ink-3 uppercase tracking-wider">{t.inFaultLabel}</dt>
              <dd className="mt-1 font-semibold text-ink tabular-nums">
                {activeScraperStats ? formatLocaleNumber(locale, activeScraperStats.scrapersInFault ?? 0) : "—"}
              </dd>
            </div>
            <div className="rounded-control bg-paper p-4">
              <dt className="text-xs font-medium text-ink-3 uppercase tracking-wider">{t.driftAlarmsLabel}</dt>
              <dd className="mt-1 font-semibold text-ink tabular-nums">
                {activeScraperStats ? formatLocaleNumber(locale, activeScraperStats.scrapersWithDrift ?? 0) : "—"}
              </dd>
            </div>
          </dl>

          {scraperSummaryList.length > 0 ? (
            <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 text-xs text-ink-2">
              {scraperSummaryList.map((item, idx) => (
                <li key={item.key || item.name || idx} className="flex items-center justify-between rounded-control border border-line bg-paper/70 px-3 py-2">
                  <span className="inline-flex items-center gap-1.5 font-medium text-ink">
                    <Server className="h-3.5 w-3.5 text-ink-3" aria-hidden />
                    {item.name || item.key}
                  </span>
                  <span className="font-mono text-ink-2">
                    {item.status || "idle"}{item.driftDetected ? t.driftSuffix : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {/* Imagery Provider & Cache Health Card */}
        <div className="rounded-card border border-line bg-card p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-control bg-paper text-ink-2">
              <Camera className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h2 className="text-base font-semibold text-ink">{t.imageryTitle}</h2>
              <p className="text-xs text-ink-3">{t.imagerySubtitle}</p>
            </div>
          </div>

          <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4 text-sm">
            <div className="rounded-control bg-paper p-4">
              <dt className="text-xs font-medium text-ink-3 uppercase tracking-wider">{t.configTotalLabel}</dt>
              <dd className="mt-1 font-semibold text-ink tabular-nums">
                {loading ? t.checking : imageProviders?.summary?.total !== undefined ? formatLocaleNumber(locale, imageProviders.summary.total) : (imageProvidersStatus ? interpolate(t.httpStatus, { status: imageProvidersStatus }) : "—")}
              </dd>
            </div>
            <div className="rounded-control bg-paper p-4">
              <dt className="text-xs font-medium text-ink-3 uppercase tracking-wider">{t.availableLabel}</dt>
              <dd className="mt-1 font-semibold text-ink tabular-nums">
                {imageProviders?.summary ? formatLocaleNumber(locale, imageProviders.summary.available ?? 0) : "—"}
              </dd>
            </div>
            <div className="rounded-control bg-paper p-4">
              <dt className="text-xs font-medium text-ink-3 uppercase tracking-wider">{t.missingKeysLabel}</dt>
              <dd className="mt-1 font-semibold text-catch-ink tabular-nums">
                {imageProviders?.summary ? formatLocaleNumber(locale, imageProviders.summary.missingKey ?? 0) : "—"}
              </dd>
            </div>
            <div className="rounded-control bg-paper p-4">
              <dt className="text-xs font-medium text-ink-3 uppercase tracking-wider">{t.openCircuitsLabel}</dt>
              <dd className="mt-1 font-semibold text-catch-ink tabular-nums">
                {imageProviders?.summary ? formatLocaleNumber(locale, imageProviders.summary.circuitOpen ?? 0) : "—"}
              </dd>
            </div>
          </dl>

          {Array.isArray(imageProviders?.providers) && imageProviders.providers.length > 0 ? (
            <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3 text-xs text-ink-2">
              {imageProviders.providers.map((provider) => {
                const available = provider.circuit?.available !== false && (!provider.requiresKey || provider.keyConfigured);
                return (
                  <li key={provider.id} className="rounded-control border border-line bg-paper/70 p-3 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-ink">{provider.label || provider.id}</span>
                      <span className={`rounded-full px-2 py-0.5 text-label font-bold uppercase ${available ? "bg-go-wash text-go" : "bg-catch-wash text-catch-ink"}`}>
                        {available ? t.healthyBadge : !provider.keyConfigured && provider.requiresKey ? t.missingKeyBadge : t.circuitOpenBadge}
                      </span>
                    </div>
                    {provider.role ? <p className="text-xs text-ink-3">{provider.role}</p> : null}
                    <div className="flex items-center justify-between text-xs font-mono text-ink-3">
                      <span>{provider.requiresKey ? (provider.keyConfigured ? t.keySet : interpolate(t.keyUnset, { envVar: provider.keyEnvVar || "Key" })) : t.publicKeyless}</span>
                      {provider.cache && typeof provider.cache.entries === "number" ? (
                        <span>{interpolate(t.cachedEntries, { count: formatLocaleNumber(locale, provider.cache.entries) })}</span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>

        {/* Security Invariants Card */}
        <div className="rounded-card border border-line bg-card p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-control bg-paper text-ink">
              <ShieldCheck className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <h2 className="text-base font-semibold text-ink">{t.secTitle}</h2>
              <p className="text-xs text-ink-3">{t.secSubtitle}</p>
            </div>
          </div>

          <ul className="mt-4 space-y-2 text-xs text-ink-2">
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-ink-3" />
              {t.secCsp}
            </li>
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-ink-3" />
              {t.secSsrf}
            </li>
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-ink-3" />
              {t.secTruth}
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
