"use client";

import React, { useEffect, useRef, useState } from "react";
import { X, Search, Trash2, ArrowRight, Bookmark } from "lucide-react";
import type { PropertyListing } from "./property-data";
import { matchesSavedSearch, parseSavedSearches, type SavedSearch } from "@/lib/saved-searches";

interface AlertsModalProps {
  isOpen: boolean;
  onClose: () => void;
  availableStates: string[];
  listings: PropertyListing[];
  onApply: (search: SavedSearch) => void;
}

const STORAGE_KEY = "perfectproperty:saved-searches:v1";

export function AlertsModal({ isOpen, onClose, availableStates, listings, onApply }: AlertsModalProps) {
  const [searches, setSearches] = useState<SavedSearch[]>([]);
  const [name, setName] = useState("");
  const [state, setState] = useState("All");
  const [minScore, setMinScore] = useState(0);
  const [maxBid, setMaxBid] = useState(0);
  const [feedback, setFeedback] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { setSearches(parseSavedSearches(localStorage.getItem(STORAGE_KEY))); }
    catch { setFeedback("Browser storage is unavailable. Saved searches cannot persist on this device."); }
  }, []);

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

  const persist = (next: SavedSearch[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setSearches(next);
      return true;
    } catch {
      setFeedback("Could not save to browser storage. Your previous saved searches are unchanged.");
      return false;
    }
  };

  const draft: SavedSearch = { id: "draft", name, state, minScore, maxBid, createdAt: "" };
  const draftMatches = listings.filter((listing) => matchesSavedSearch(listing, draft)).length;
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
          <p className="rounded-xl bg-sky-50 px-4 py-3 text-xs leading-relaxed text-sky-950">Saved on this browser only. Matches update when inventory refreshes. Email delivery and background monitoring are not connected.</p>
          <form className="space-y-4" onSubmit={(event) => {
            event.preventDefault();
            if (searches.length >= 50) { setFeedback("You have 50 saved searches. Remove one before adding another."); return; }
            const record: SavedSearch = { ...draft, id: crypto.randomUUID(), name: name.trim() || (state === "All" ? "All-market search" : state + " opportunities"), createdAt: new Date().toISOString() };
            if (persist([record, ...searches])) { setName(""); setFeedback("Search saved on this browser."); }
          }}>
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
              <button type="submit" className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800"><Bookmark className="h-4 w-4" /> Save search</button>
            </div>
          </form>
          {feedback && <p role="status" className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-700">{feedback}</p>}
          <section aria-label="Your saved searches" className="space-y-3 border-t border-slate-100 pt-5">
            <h3 className="text-sm font-semibold">Your searches ({searches.length})</h3>
            {!searches.length && <div className="rounded-2xl border border-dashed border-slate-200 p-6 text-center"><Search className="mx-auto h-6 w-6 text-slate-400" /><p className="mt-2 text-sm text-slate-500">No saved searches yet. Start with the market you invest in.</p></div>}
            {searches.map((search) => {
              const matches = listings.filter((listing) => matchesSavedSearch(listing, search));
              return <article key={search.id} className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><h4 className="break-words font-semibold">{search.name}</h4><p className="mt-1 text-xs text-slate-500">{search.state === "All" ? "All markets" : search.state} · {search.minScore > 0 ? "Score ≥ " + search.minScore : "Any score"} · {search.maxBid > 0 ? "Bid ≤ $" + search.maxBid.toLocaleString() : "Any bid"}</p></div>
                  <button type="button" onClick={() => { if (persist(searches.filter((item) => item.id !== search.id))) setFeedback("Saved search removed."); }} aria-label={"Delete saved search " + search.name} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
                </div>
                <button type="button" onClick={() => onApply(search)} className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-emerald-700">View {matches.length} matches <ArrowRight className="h-4 w-4" /></button>
                <p className="mt-1 text-[11px] text-slate-500">Includes explicitly labeled demo / unverified records. This is not an alert-delivery service.</p>
              </article>;
            })}
          </section>
        </div>
      </div>
    </div>
  );
}
