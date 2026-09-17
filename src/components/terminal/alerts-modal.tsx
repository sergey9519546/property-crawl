"use client";

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
  const [serverSearches, setServerSearches] = useState<ServerSavedSearch[]>([]);
  const [alertMatches, setAlertMatches] = useState<AlertMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [name, setName] = useState("");
  const [state, setState] = useState("All");
  const [minScore, setMinScore] = useState(0);
  const [maxBid, setMaxBid] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [runningId, setRunningId] = useState<string | null>(null);
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
      if (status === 401) setError("Unlock the workspace to use saved searches and alerts.");
      else if (status === 503) setError("Workspace is not configured for private features.");
      else setError(e?.message || "Failed to load saved searches.");
      // Keep previous data visible; do not wipe on transient error.
    } finally {
      setLoading(false);
    }
  }, []);

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
    const filters = buildServerFilters(state, minScore, maxBid);
    if (Object.keys(filters).length === 0) {
      setFeedback("Add at least one filter (state, min score, or max bid).");
      return;
    }
    try {
      await createSavedSearch(name.trim() || null, filters);
      setName("");
      await loadAll();
      setFeedback("Search saved to workspace.");
    } catch (e: any) {
      const status = (e as any)?.status;
      if (status === 401) setError("Unlock the workspace first.");
      else setError(e?.message || "Failed to save search.");
    }
  }

  async function handleDelete(id: string) {
    setFeedback(""); setError("");
    try {
      await deleteSavedSearch(id);
      await loadAll();
      setFeedback("Saved search removed.");
    } catch (e: any) {
      setError(e?.message || "Failed to remove search.");
    }
  }

  async function handleRun(id: string) {
    setRunningId(id); setFeedback(""); setError("");
    try {
      const res = await runSavedSearch(id);
      await loadAll();
      setFeedback(`Run complete. ${res.newMatches} new match(es) recorded (scanned ${res.scanned}).`);
    } catch (e: any) {
      setError(e?.message || "Run failed.");
    } finally {
      setRunningId(null);
    }
  }

  async function handleMarkAllRead() {
    const unread = alertMatches.filter((m) => !m.readAt).map((m) => m.id);
    if (unread.length === 0) return;
    try {
      await markAlertMatchesRead(unread);
      await loadAll();
      setFeedback("All matches marked read.");
    } catch (e: any) {
      setError(e?.message || "Failed to mark read.");
    }
  }

  // Client-side draft preview (uses the listings prop passed by parent for "X matching in loaded inventory")
  const draft: SavedSearch = { id: "draft", name, state, minScore, maxBid, createdAt: "" };
  const draftMatches = listings.filter((listing) => matchesSavedSearch(listing, draft)).length;

  // Convert server list for display + onApply
  const clientSearches: SavedSearch[] = serverSearches.map(toClientSavedSearch);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label="Deal Alerts Manager" className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white text-slate-950 shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 p-6">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-emerald-700">Your research workspace</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">Saved searches</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">Save your criteria, see matching inventory, and reopen the search in one click.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close Alerts Dialog" className="rounded-full p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </header>

        <div className="space-y-6 overflow-y-auto p-6">
          <div className="flex items-center justify-between">
            <p className="rounded-xl bg-sky-50 px-4 py-3 text-xs leading-relaxed text-sky-950">
              Workspace-backed. Runs against the live pool on demand and records matches for later review. Background email delivery is not yet wired.
            </p>
            {unreadCount > 0 && (
              <button onClick={handleMarkAllRead} className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800 hover:bg-amber-100">
                <Check className="h-3.5 w-3.5" /> Mark {unreadCount} read
              </button>
            )}
          </div>

          <form className="space-y-4" onSubmit={handleCreate}>
            <div>
              <label htmlFor="saved-search-name" className="text-xs font-semibold text-slate-600">Search name</label>
              <input id="saved-search-name" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="e.g. New Jersey under $250k" className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200" />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="saved-search-state" className="text-xs font-semibold text-slate-600">State market</label>
                <select id="saved-search-state" value={state} onChange={(event) => setState(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                  <option value="All">All available states</option>
                  {availableStates.map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="saved-search-score" className="text-xs font-semibold text-slate-600">Minimum modeled score</label>
                <select id="saved-search-score" value={minScore} onChange={(event) => setMinScore(Number(event.target.value))} className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                  <option value={0}>Any / not modeled</option>
                  {[50, 60, 70, 80, 90].map((value) => <option key={value} value={value}>{value} or higher</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="saved-search-bid" className="text-xs font-semibold text-slate-600">Maximum opening bid</label>
                <select id="saved-search-bid" value={maxBid} onChange={(event) => setMaxBid(Number(event.target.value))} className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm">
                  <option value={0}>Any / not published</option>
                  {[100000, 150000, 250000, 500000, 1000000].map((value) => <option key={value} value={value}>$ {value.toLocaleString()}</option>)}
                </select>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-slate-600" aria-live="polite">{draftMatches} matching records in loaded inventory</p>
              <button type="submit" disabled={loading} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"><Bookmark className="h-4 w-4" /> Save search</button>
            </div>
          </form>

          {(feedback || error) && (
            <p role="status" className={`rounded-xl px-4 py-3 text-sm ${error ? "bg-red-50 text-red-700" : "bg-slate-100 text-slate-700"}`}>
              {error || feedback}
            </p>
          )}

          <section aria-label="Your saved searches" className="space-y-3 border-t border-slate-100 pt-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Your searches ({serverSearches.length})</h3>
              {loading && <span className="text-[11px] text-slate-500">Loading…</span>}
            </div>
            {!serverSearches.length && !loading && (
              <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center">
                <Search className="mx-auto h-6 w-6 text-slate-400" />
                <p className="mt-2 text-sm text-slate-500">No saved searches yet. Add filters above and save.</p>
              </div>
            )}
            {clientSearches.map((search, idx) => {
              const server = serverSearches[idx];
              const matches = listings.filter((listing) => matchesSavedSearch(listing, search));
              const matchCountForSearch = alertMatches.filter((m) => m.searchId === search.id).length;
              const unreadForSearch = alertMatches.filter((m) => m.searchId === search.id && !m.readAt).length;
              return (
                <article key={search.id} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="break-words font-semibold">{search.name}</h4>
                      <p className="mt-1 text-xs text-slate-500">
                        {search.state === "All" ? "All markets" : search.state} · {search.minScore > 0 ? "Score ≥ " + search.minScore : "Any score"} · {search.maxBid > 0 ? "Bid ≤ $" + search.maxBid.toLocaleString() : "Any bid"}
                        {server?.lastRunAt ? ` · last run ${new Date(server.lastRunAt).toLocaleDateString()}` : ""}
                      </p>
                      {unreadForSearch > 0 && <span className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">{unreadForSearch} new</span>}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleRun(search.id)}
                        disabled={runningId === search.id}
                        aria-label={"Run saved search " + search.name}
                        className="rounded-lg p-2 text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
                        title="Run now against live pool"
                      >
                        <Play className={`h-4 w-4 ${runningId === search.id ? "animate-pulse" : ""}`} />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(search.id)}
                        aria-label={"Delete saved search " + search.name}
                        className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => onApply(search)} className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700">
                      View {matches.length} matches in current inventory <ArrowRight className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => handleRun(search.id)} disabled={runningId === search.id} className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-60">
                      {runningId === search.id ? "Running…" : "Run against live pool"}
                    </button>
                    {matchCountForSearch > 0 && (
                      <span className="text-[11px] text-slate-500">· {matchCountForSearch} recorded match{matchCountForSearch === 1 ? "" : "es"}</span>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">Includes explicitly labeled demo / unverified records. This is not an alert-delivery service.</p>
                </article>
              );
            })}
          </section>
        </div>
      </div>
    </div>
  );
}
