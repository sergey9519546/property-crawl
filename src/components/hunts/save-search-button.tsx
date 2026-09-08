"use client";

import Link from "next/link";
import { FormEvent, useRef, useState } from "react";
import { Check, Loader2, Save, X } from "lucide-react";
import { useWorkspaceSession } from "@/components/workspace/workspace-shell";
import type { DiscoveryFilters } from "@/lib/discovery-query";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

const MATCH_FILTERS = [
  "q", "state", "county", "source", "type", "program", "lifecycle", "saleFrom", "saleTo",
  "maxBid", "minScore", "minEquity", "occupancy", "freshness", "hasDocuments", "seniorLien", "redemption",
] as const;

export function SaveSearchButton({ filters }: { filters: DiscoveryFilters }) {
  const session = useWorkspaceSession();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("My property search");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedId, setSavedId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  function begin() {
    if (!session.authenticated) {
      session.requestUnlock();
      return;
    }
    setError("");
    setSavedId(null);
    setOpen(true);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) {
      setError("Enter a name for this search.");
      return;
    }
    const discoveryFilters: Record<string, string> = {};
    for (const key of MATCH_FILTERS) {
      const value = filters[key];
      if (typeof value === "string" && value.trim() && value !== "all") discoveryFilters[key] = value.trim();
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/hunts", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: cleanName, enabled: true, criteria: { discoveryFilters } }),
      });
      const result = await response.json();
      if (response.status === 401) {
        setOpen(false);
        session.requestUnlock();
        throw new Error("Your workspace session expired. Unlock it, then save again.");
      }
      if (!response.ok) throw new Error(result.error || result.details?.[0] || "The search could not be saved.");
      setSavedId(result.hunt.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The search could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <button ref={triggerRef} type="button" onClick={begin} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50">
      <Save size={15} /> Save search
    </button>
    <Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }}>
      <DialogContent showCloseButton={false} className="gap-0 rounded-2xl bg-white p-5 sm:max-w-md" onOpenAutoFocus={(event) => { event.preventDefault(); inputRef.current?.focus(); }} onCloseAutoFocus={(event) => { event.preventDefault(); triggerRef.current?.focus(); }}>
        <div className="flex items-start justify-between gap-4">
          <div><DialogTitle className="text-lg font-bold text-slate-950">Save this search</DialogTitle><DialogDescription className="mt-1 text-sm text-slate-600">Monitor properties matching your current filters.</DialogDescription></div>
          <button type="button" aria-label="Close" disabled={busy} onClick={() => setOpen(false)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100"><X size={18} /></button>
        </div>
        {savedId ? <div className="mt-5 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="flex items-center gap-2 font-semibold"><Check size={17} /> Search saved</p>
          <Link href={`/hunts?hunt=${encodeURIComponent(savedId)}`} className="mt-3 inline-flex font-semibold underline">Review saved search</Link>
        </div> : <form onSubmit={save} className="mt-5">
          <label htmlFor="saved-search-name" className="text-sm font-semibold text-slate-800">Name</label>
          <input ref={inputRef} id="saved-search-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} disabled={busy} className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-slate-900" />
          {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" disabled={busy} onClick={() => setOpen(false)} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100">Cancel</button>
            <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy && <Loader2 size={15} className="animate-spin" />} Save</button>
          </div>
        </form>}
      </DialogContent>
    </Dialog>
    {!open && error ? <p role="alert" className="text-sm text-red-700">{error}</p> : null}
  </>;
}
