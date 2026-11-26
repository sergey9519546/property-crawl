"use client";

import { useLocale } from "@/components/i18n/locale-provider";
import { formatUsd, formatLocaleDate, formatLocaleNumber } from "@/lib/i18n/translator";

import React, { useEffect, useRef, useState } from "react";
import { X, Search, Trash2, ArrowRight, Bookmark, Play, Check } from "lucide-react";
import type { PropertyListing } from "./property-data";
import {
  matchesSavedSearch,
  parseSavedSearches,
  type SavedSearch,
  type ServerSavedSearch,
  toClientSavedSearch,
  buildServerFilters,
  listSavedSearches,
  createSavedSearch,
  deleteSavedSearch,
  runSavedSearch,
  listAlertMatches,
  markAlertMatchesRead,
  promoteSavedSearchToHunt,
  type AlertMatch
} from "@/lib/saved-searches";

interface AlertsModalProps {
  isOpen: boolean;
  onClose: () => void;
  availableStates: string[];
  listings: PropertyListing[];
  onApply: (search: SavedSearch) => void;
}

export function AlertsModal({ isOpen, onClose, availableStates, listings, onApply }: AlertsModalProps) {
  const { locale, messages, format } = useLocale();
  const t = messages.modalsAndParser;
  const [serverSearches, setServerSearches] = useState<ServerSavedSearch[]>([]);
  const [alertMatches, setAlertMatches] = useState<AlertMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [name, setName] = useState("");
  const [state, setState] = useState("All");
  const [minScore, setMinScore] = useState(0);
  const [maxBid, setMaxBid] = useState(0);
  const [notifyEmail, setNotifyEmail] = useState("");
  const [feedback, setFeedback] = useState("");
  const [runningId, setRunningId] = useState<string | null>(null);
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const [promotedHunts, setPromotedHunts] = useState<Record<string, string>>({});
  const panelRef = useRef<HTMLDivElement>(null);

  // Strict server-backed load on open. No silent local-only fallback for the list.
  const loadAll = React.useCallback(async () => {
    setLoading(true); setError(""); setFeedback("");
    try {
      const [searchesRes, matchesRes] = await Promise.all([
        listSavedSearches().catch((e: any) => { throw e; }),
        listAlertMatches(false, 100).catch((e: any) => { throw e; })
      ]);
      setServerSearches(searchesRes);
      setAlertMatches(matchesRes);
    } catch (e: any) {
      const status = (e as any)?.status;
      if (status === 401) setError(t.alertsUnlockRequired);
      else if (status === 503) setError(t.alertsNotConfigured);
      else setError(e?.message || t.alertsLoadFailed);
      // Keep previous data visible; do not wipe on transient error.
    } finally {
      setLoading(false);
    }
  }, [t.alertsLoadFailed, t.alertsNotConfigured, t.alertsUnlockRequired]);

  useEffect(() => {
    if (isOpen) void loadAll();
  }, [isOpen, loadAll]);

  useEffect(() => {
    if (!isOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const elements = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select, [tabindex="0"]') || []);
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", keydown);
      previousFocus?.focus();
    };
  }, [isOpen, onClose]);

  const unreadCount = alertMatches.filter((m) => !m.readAt).length;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(""); setError("");
    const filters = buildServerFilters(state, minScore, maxBid, notifyEmail);
    if (!filters.states && !filters.minScore && !filters.maxBid) {
      setFeedback(t.alertsAddOneFilter);
      return;
    }
    try {
      await createSavedSearch(name.trim() || null, filters);
      setName("");
      await loadAll();
      setFeedback(t.alertsSavedMsg);
    } catch (e: any) {
      const status = (e as any)?.status;
      if (status === 401) setError(t.alertsUnlockFirst);
      else setError(e?.message || t.alertsSaveFailed);
    }
  }

  async function handleDelete(id: string) {
    setFeedback(""); setError("");
    try {
      await deleteSavedSearch(id);
      await loadAll();
      setFeedback(t.alertsRemovedMsg);
    } catch (e: any) {
      setError(e?.message || t.alertsRemoveFailed);
    }
  }

  async function handleRun(id: string) {
    setRunningId(id); setFeedback(""); setError("");
    try {
      const res = await runSavedSearch(id);
      await loadAll();
      setFeedback(format(t.alertsRunCompleteMsg, { newMatches: res.newMatches, scanned: res.scanned }));
    } catch (e: any) {
      setError(e?.message || t.alertsRunFailed);
    } finally {
      setRunningId(null);
    }
  }

  async function handlePromote(search: SavedSearch, server?: ServerSavedSearch) {
    setPromotingId(search.id); setFeedback(""); setError("");
    try {
      const hunt = await promoteSavedSearchToHunt(search, server);
      setPromotedHunts((prev) => ({ ...prev, [search.id]: hunt.id }));
      await loadAll();
      setFeedback(format(t.alertsPromotedMsg, { name: search.name }));
    } catch (e: any) {
      const status = (e as any)?.status;
      if (status === 401) setError(t.alertsUnlockFirst);
      else setError(e?.message || t.alertsPromoteFailed);
    } finally {
      setPromotingId(null);
    }
  }

  async function handleMarkAllRead() {
    const unread = alertMatches.filter((m) => !m.readAt).map((m) => m.id);
    if (unread.length === 0) return;
    try {
      await markAlertMatchesRead(unread);
      await loadAll();
      setFeedback(t.alertsAllReadMsg);
    } catch (e: any) {
      setError(e?.message || t.alertsMarkReadFailed);
    }
  }

  // Client-side draft preview (uses the listings prop passed by parent for "X matching in loaded inventory")
  const draft: SavedSearch = { id: "draft", name, state, minScore, maxBid, createdAt: "" };
  const draftMatches = listings.filter((listing) => matchesSavedSearch(listing, draft)).length;

  // Convert server list for display + onApply
  const clientSearches: SavedSearch[] = serverSearches.map(toClientSavedSearch);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={t.alertsDialogAria} className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-card bg-card text-ink shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-line p-6">
          <div>
            <p className="text-label font-bold uppercase tracking-[0.16em] text-ink-3">{t.alertsEyebrow}</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">{t.alertsTitle || "Saved searches"}</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-3">{t.alertsSubtitle}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t.alertsCloseAria} className="rounded-full p-2 text-ink-3 hover:bg-paper"><X className="h-5 w-5" /></button>
        </header>

        <div className="space-y-6 overflow-y-auto p-6">
          <div className="flex items-center justify-between">
            <p className="rounded-control bg-paper px-4 py-3 text-xs leading-relaxed text-ink-2">
              {t.alertsWorkspaceIntro}{" "}
              {t.alertsDeliveryLimit || "Email is sent only when this search stores an address and the server has RESEND_API_KEY and RESEND_FROM. Otherwise matches stay in this workspace."}
            </p>
            {unreadCount > 0 && (
              <button onClick={handleMarkAllRead} className="inline-flex items-center gap-1 rounded-control border border-line-strong bg-paper px-2 py-1 text-label font-semibold text-ink-2 hover:bg-line">
                <Check className="h-3.5 w-3.5" /> {format(t.alertsMarkNRead, { count: unreadCount })}
              </button>
            )}
          </div>

          <form className="space-y-4" onSubmit={handleCreate}>
            <div>
              <label htmlFor="saved-search-name" className="text-xs font-semibold text-ink-3">{t.alertsSearchName}</label>
              <input id="saved-search-name" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder={t.alertsSearchPlaceholder} className="mt-1 h-11 w-full rounded-control border border-line-strong bg-card px-3 text-sm focus:outline-none" />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="saved-search-state" className="text-xs font-semibold text-ink-3">{t.alertsStateMarket}</label>
                <select id="saved-search-state" value={state} onChange={(event) => setState(event.target.value)} className="mt-1 h-11 w-full rounded-control border border-line-strong bg-card px-3 text-sm">
                  <option value="All">{t.alertsAllStatesOption}</option>
                  {availableStates.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="saved-search-score" className="text-xs font-semibold text-ink-3">{t.alertsMinScore}</label>
                <select id="saved-search-score" value={minScore} onChange={(event) => setMinScore(Number(event.target.value))} className="mt-1 h-11 w-full rounded-control border border-line-strong bg-card px-3 text-sm">
                  <option value={0}>{t.alertsAnyScoreOpt}</option>
                  {[50, 60, 70, 80, 90].map((value) => <option key={value} value={value}>{format(t.alertsScoreOrHigher, { score: value })}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="saved-search-bid" className="text-xs font-semibold text-ink-3">{t.alertsMaxBid}</label>
                <select id="saved-search-bid" value={maxBid} onChange={(event) => setMaxBid(Number(event.target.value))} className="mt-1 h-11 w-full rounded-control border border-line-strong bg-card px-3 text-sm">
                  <option value={0}>{t.alertsAnyBidOpt}</option>
                  {[100000, 150000, 250000, 500000, 1000000].map((value) => <option key={value} value={value}>{formatUsd(locale, value)}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="saved-search-email" className="text-xs font-semibold text-ink-3">{t.alertsNotifyEmail}</label>
              <input id="saved-search-email" type="email" value={notifyEmail} maxLength={320} onChange={(event) => setNotifyEmail(event.target.value)} placeholder="you@company.com" className="mt-1 h-11 w-full rounded-control border border-line-strong bg-card px-3 text-sm focus:outline-none" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-ink-3" aria-live="polite">{format(t.alertsMatchingLoaded, { count: formatLocaleNumber(locale, draftMatches) })}</p>
              <button type="submit" disabled={loading} className="inline-flex items-center gap-2 rounded-control bg-ink px-4 py-3 text-sm font-semibold text-white hover:bg-ink-2 disabled:opacity-60"><Bookmark className="h-4 w-4" /> {t.alertsSaveSearchBtn}</button>
            </div>
          </form>

          {(feedback || error) && (
            <p role="status" className={`rounded-control px-4 py-3 text-sm ${error ? "bg-catch-wash text-catch-ink" : "bg-paper text-ink-2"}`}>
              {error || feedback}
            </p>
          )}

          <section aria-label={t.alertsSectionAria} className="space-y-3 border-t border-line pt-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">{format(t.alertsYourSearches, { count: serverSearches.length })}</h3>
              {loading && <span className="text-label text-ink-3">{t.alertsLoading}</span>}
            </div>
            {!serverSearches.length && !loading && (
              <div className="rounded-control border border-dashed border-line p-6 text-center">
                <Search className="mx-auto h-6 w-6 text-ink-3" />
                <p className="mt-2 text-sm text-ink-3">{t.alertsEmpty}</p>
              </div>
            )}
            {clientSearches.map((search, idx) => {
              const server = serverSearches[idx];
              const matches = listings.filter((listing) => matchesSavedSearch(listing, search));
              const matchCountForSearch = alertMatches.filter((m) => m.searchId === search.id).length;
              const unreadForSearch = alertMatches.filter((m) => m.searchId === search.id && !m.readAt).length;
              return (
                <article key={search.id} className="rounded-control border border-line p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="break-words font-semibold">{search.name}</h4>
                      <p className="mt-1 text-xs text-ink-3">
                        {search.state === "All" ? t.alertsAllMarkets : search.state} · {search.minScore > 0 ? format(t.alertsScoreGte, { score: search.minScore }) : t.alertsAnyScore} · {search.maxBid > 0 ? format(t.alertsBidLte, { amount: formatUsd(locale, search.maxBid) }) : t.alertsAnyBid}
                        {server?.lastRunAt ? ` · ${format(t.alertsLastRunPrefix, { date: formatLocaleDate(locale, server.lastRunAt) })}` : ""}
                      </p>
                      {unreadForSearch > 0 && <span className="mt-1 inline-block rounded bg-line px-1.5 py-0.5 text-label font-semibold text-ink">{format(t.alertsNewCount, { count: unreadForSearch })}</span>}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleRun(search.id)}
                        disabled={runningId === search.id}
                        aria-label={format(t.alertsRunAria, { name: search.name })}
                        className="rounded-lg p-2 text-go hover:bg-go-wash disabled:opacity-50"
                        title={t.alertsRunTitle}
                      >
                        <Play className={`h-4 w-4 ${runningId === search.id ? "animate-pulse" : ""}`} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(search.id)}
                        aria-label={format(t.alertsDeleteAria, { name: search.name })}
                        className="rounded-lg p-2 text-ink-3 hover:bg-catch-wash hover:text-catch-ink"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => onApply(search)} className="inline-flex items-center gap-2 text-sm font-semibold text-go">
                      {format(t.alertsViewCurrentMatches, { count: matches.length })} <ArrowRight className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => handleRun(search.id)} disabled={runningId === search.id} className="inline-flex items-center gap-1 rounded-lg border border-go/30 bg-go-wash px-2 py-1 text-xs font-semibold text-go hover:bg-go-fill/20 disabled:opacity-60">
                      {runningId === search.id ? t.alertsRunningBtn : t.alertsRunBtn}
                    </button>
                    <button
                      type="button"
                      onClick={() => handlePromote(search, server)}
                      disabled={promotingId === search.id}
                      className="inline-flex items-center gap-1 rounded-lg border border-line-strong bg-paper px-2 py-1 text-xs font-semibold text-ink-2 hover:bg-line disabled:opacity-60"
                    >
                      {promotingId === search.id ? t.alertsPromotingBtn : promotedHunts[search.id] ? t.alertsPromotedHunt : (t.alertsPromoteHunt || "Promote to Hunt")}
                    </button>
                    {promotedHunts[search.id] && (
                      <a
                        href={`/hunts?hunt=${encodeURIComponent(promotedHunts[search.id])}`}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-go hover:underline"
                      >
                        {t.alertsOpenHunt}
                      </a>
                    )}
                    {matchCountForSearch > 0 && (
                      <span className="text-label text-ink-3">· {format(matchCountForSearch === 1 ? t.alertsMatchesSingular : t.alertsMatchesPlural, { count: matchCountForSearch })}</span>
                    )}
                  </div>
                  <p className="mt-1 text-label text-ink-3">{t.alertsDemoNotice}</p>
                </article>
              );
            })}
          </section>
        </div>
      </div>
    </div>
  );
}
