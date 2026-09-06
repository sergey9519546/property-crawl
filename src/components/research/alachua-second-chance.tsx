"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Building2, Download, ExternalLink, FileCheck2, LandPlot, Loader2, MapPinned, RefreshCw, Search } from "lucide-react";
import { PrivateWorkspaceGate, useWorkspaceSession } from "@/components/workspace/workspace-shell";
import { sourceDisplayText } from "@/lib/source-display";

type Intake = { id: string; sourceId: string; sourceUrl: string; capturedAt: string; review?: { decision?: string } };
type CountyRecord = {
  sourceRef: { sourceId: string; recordId: string }; caseNumber: string; rawStatus: string; status: string; observedAt: string; freshness: string;
  rawParcelIds: string[]; advertisedPropertyType?: string | null; saleDate?: string | null; currentAvailability: string;
  purchaseTerms: { components: Record<string, number | null>; currentPurchaseQuote: null; quoteStatus: string; guidance?: { source?: { url?: string } } };
  documents?: { type: string; title: string; url: string; sha256?: string | null; factStatus: string }[];
  statusHistory?: { rawStatus: string; status: string; observedAt: string; source?: { url?: string } }[];
  statusConflicts?: { observedAt: string; rawStatuses: string[] }[];
  parcels?: { status: string; rawParcelId?: string; properties?: Record<string, unknown>; planning?: Record<string, unknown>; propertyAppraiserUrl?: string | null; source?: { url?: string } }[];
  parcelMaps?: { rawParcelId: string; propertyAppraiserUrl?: string | null }[];
  signals?: { id: string; title: string; category?: string; explanation?: string; nextAction?: string }[];
  issues?: { code: string; message: string; rawParcelId?: string }[];
};
type Pilot = { packetId: string; coverage: string; completeCountyInventory: boolean; generatedAt: string; parcelLookups: number; limitation: string; records: CountyRecord[]; historyCoverage?: Record<string, unknown> };

const money = (value: unknown) => typeof value === "number" ? value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }) : "Unknown";
const words = (value: string) => sourceDisplayText(value.replaceAll("_", " "));

export function AlachuaSecondChance() {
  const session = useWorkspaceSession();
  const [intake, setIntake] = React.useState<Intake[]>([]);
  const [selected, setSelected] = React.useState("");
  const [pilot, setPilot] = React.useState<Pilot | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [message, setMessage] = React.useState("");

  const loadIntake = React.useCallback(async () => {
    if (!session.authenticated) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/source-network/intake?includeContent=false", { cache: "no-store", credentials: "same-origin" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Reviewed county packets could not be loaded");
      const items = (result.items || []).filter((item: Intake) => item.sourceId === "alachua-tax-deeds" && item.review?.decision === "approved");
      setIntake(items); if (items[0] && !selected) setSelected(items[0].id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Reviewed county packets could not be loaded"); }
    finally { setBusy(false); }
  }, [selected, session.authenticated]);

  React.useEffect(() => { void loadIntake(); }, [loadIntake]);

  async function build(lookupParcels: boolean) {
    if (!selected) { setError("Choose an approved county evidence packet first."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/workspace/alachua/pilot", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intakeId: selected, lookupParcels, maxParcelLookups: 5 }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "County review could not be built");
      setPilot(result.pilot); setMessage(lookupParcels ? `County parcel research finished with ${result.pilot.parcelLookups} bounded lookup${result.pilot.parcelLookups === 1 ? "" : "s"}.` : "Reviewed county packet reconstructed without making network requests.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "County review could not be built"); }
    finally { setBusy(false); }
  }

  function download() {
    if (!pilot) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(pilot, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `alachua-second-chance-${pilot.packetId}.json`; anchor.click(); URL.revokeObjectURL(url);
  }

  return <div className="mx-auto max-w-[1380px] px-5 py-9 sm:px-8">
    <Link href="/research" className="inline-flex items-center gap-2 text-xs font-semibold text-[#6B7280]"><ArrowLeft size={14} />Research inbox</Link>
    <div className="mt-6 grid items-end gap-6 lg:grid-cols-[1fr_380px]"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">County pilot · Alachua County, Florida</p><h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-6xl">Second chance review</h1><p className="mt-4 max-w-3xl text-sm leading-7 text-[#6B7280]">Start from a reviewed tax-deed packet explicitly recording public-purchase availability. Preserve the original notice, exact parcel IDs, status history, published cost parts, parcel evidence, and the unresolved current clerk quote.</p></div><div className="rounded-2xl bg-[#0F172A] p-5 text-xs leading-6 text-slate-200"><strong className="block text-white">Evidence boundary</strong>Catalog enrollment does not claim live county coverage. Reviewed imports are leads; property availability and a current purchase quote require current confirmation.</div></div>
    <div className="mt-8"><PrivateWorkspaceGate title="Unlock the county review workflow">
      <section className="rounded-2xl border border-[#E5E7EB] bg-white p-5"><div className="flex flex-wrap items-end gap-3"><label className="min-w-[260px] flex-1 text-xs font-semibold">Approved county packet<select value={selected} onChange={(event) => { setSelected(event.target.value); setPilot(null); }} className="mt-2 w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-3 text-sm font-normal"><option value="">Choose a reviewed import</option>{intake.map((item) => <option key={item.id} value={item.id}>{item.id} · captured {new Date(item.capturedAt).toLocaleDateString()}</option>)}</select></label><button type="button" disabled={busy} onClick={() => void loadIntake()} className="inline-flex items-center gap-2 rounded-lg border border-[#E5E7EB] px-4 py-3 text-xs font-semibold"><RefreshCw size={14} />Reload packets</button><button type="button" disabled={busy || !selected} onClick={() => void build(false)} className="inline-flex items-center gap-2 rounded-lg bg-[#0F172A] px-4 py-3 text-xs font-semibold text-white">{busy ? <Loader2 size={14} className="animate-spin" /> : <FileCheck2 size={14} />}Build reviewed cases</button><button type="button" disabled={busy || !selected} onClick={() => void build(true)} className="inline-flex items-center gap-2 rounded-lg bg-[#0F172A] px-4 py-3 text-xs font-semibold text-white"><Search size={14} />Research up to 5 parcels</button></div><p className="mt-3 text-[11px] leading-5 text-[#9CA3AF]">“Research parcels” is an explicit external action. It uses the bounded county adapter and preserves ambiguous or unavailable matches instead of forcing an identity.</p></section>
      {error && <p role="alert" className="mt-4 rounded-xl bg-amber-100 p-4 text-sm text-amber-950">{error}</p>}{message && <p role="status" className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-950">{message}</p>}
      {!intake.length && !busy && <div className="mt-5 rounded-2xl border border-dashed border-[#E5E7EB] bg-white p-7"><AlertTriangle className="text-amber-700" /><h2 className="mt-4 text-xl font-semibold">No approved Alachua packet yet.</h2><p className="mt-2 text-sm leading-6 text-[#6B7280]">Open Sources, choose the Alachua County tax-deed workflow, import a structured JSON packet from the exact county record, then approve it in the evidence queue.</p><Link href="/sources" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-slate-900 underline hover:text-slate-700">Open the source workflow <ExternalLink size={14} /></Link></div>}
      {pilot && <><div className="mt-5 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-[#6B7280]">{pilot.records.length} reviewed case{pilot.records.length === 1 ? "" : "s"} · {words(pilot.coverage)} · county inventory completeness: {pilot.completeCountyInventory ? "verified" : "not established"}</p><button type="button" onClick={download} className="inline-flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-xs font-semibold"><Download size={14} />Export this review</button></div><div className="mt-4 space-y-5">{pilot.records.map((record) => <article key={record.sourceRef.recordId} className="rounded-2xl border border-[#E5E7EB] bg-white p-5 sm:p-7"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap gap-2"><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${record.status === "available_for_public" ? "bg-emerald-100 text-emerald-900" : "bg-amber-100 text-amber-900"}`}>{words(record.status)}</span><span className="rounded-full bg-stone-100 px-2.5 py-1 text-[10px] font-bold uppercase text-stone-700">{words(record.freshness)}</span></div><h2 className="mt-3 text-2xl font-semibold">Case {sourceDisplayText(record.caseNumber)}</h2><p className="mt-2 text-xs text-[#9CA3AF]">{sourceDisplayText(record.sourceRef.sourceId)} · {sourceDisplayText(record.sourceRef.recordId)} · observed {new Date(record.observedAt).toLocaleString()}</p></div><p className="rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-950">Current purchase quote: unresolved</p></div>
          <div className="mt-5 grid gap-4 lg:grid-cols-3"><div className="rounded-xl bg-[#F1F5F9] p-4"><p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider"><LandPlot size={15} />Parcel identity</p><p className="mt-3 break-all text-sm font-semibold">{record.rawParcelIds.join(", ")}</p><p className="mt-2 text-xs text-[#6B7280]">Address similarity is not used to force this identity.</p></div><div className="rounded-xl bg-[#F1F5F9] p-4"><p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider"><Building2 size={15} />Offering description</p><p className="mt-3 text-sm font-semibold">{record.advertisedPropertyType || "Unknown"}</p><p className="mt-2 text-xs text-[#6B7280]">Matched building records appear as discrepancy signals, not automatic corrections.</p></div><div className="rounded-xl bg-[#F1F5F9] p-4"><p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider"><MapPinned size={15} />Parcel research</p><p className="mt-3 text-sm font-semibold">{record.parcels?.length || 0} adapter response{record.parcels?.length === 1 ? "" : "s"}</p><div className="mt-2 space-y-1">{record.parcelMaps?.map((map) => map.propertyAppraiserUrl ? <a key={map.rawParcelId} href={map.propertyAppraiserUrl} target="_blank" rel="noreferrer" className="block text-xs text-slate-900 underline hover:text-slate-700">Official parcel {map.rawParcelId}</a> : null)}</div></div></div>
          <div className="mt-5 grid gap-5 lg:grid-cols-2"><div><h3 className="text-sm font-semibold">Published cost components</h3><dl className="mt-3 divide-y divide-[#E5E7EB] rounded-xl border border-[#E5E7EB]">{Object.entries(record.purchaseTerms.components).map(([key, value]) => <div key={key} className="flex justify-between gap-4 p-3 text-xs"><dt className="text-[#6B7280]">{words(key)}</dt><dd className="font-semibold">{money(value)}</dd></div>)}</dl></div><div><h3 className="text-sm font-semibold">Status history</h3><ol className="mt-3 space-y-2">{record.statusHistory?.map((item, index) => <li key={`${item.observedAt}-${index}`} className="rounded-xl border border-[#E5E7EB] p-3 text-xs"><p className="font-semibold">{sourceDisplayText(item.rawStatus)}</p><p className="mt-1 text-[#9CA3AF]">{new Date(item.observedAt).toLocaleString()}</p></li>)}{!record.statusHistory?.length && <li className="text-xs text-[#9CA3AF]">No earlier approved observation.</li>}</ol></div></div>
          {(record.signals?.length || record.issues?.length) ? <div className="mt-5 grid gap-3 lg:grid-cols-2">{record.signals?.map((signal) => <div key={signal.id} className="rounded-xl bg-slate-100 p-4 text-xs leading-5 text-slate-950"><p className="font-semibold">{sourceDisplayText(signal.title)}</p><p className="mt-1">{sourceDisplayText(signal.explanation || "Review the linked evidence.")}</p>{signal.nextAction && <p className="mt-2 font-semibold">Next: {sourceDisplayText(signal.nextAction)}</p>}</div>)}{record.issues?.map((issue, index) => <div key={`${issue.code}-${index}`} className="rounded-xl bg-amber-50 p-4 text-xs leading-5 text-amber-950"><p className="font-semibold">{words(issue.code)}</p><p className="mt-1">{sourceDisplayText(issue.message)}</p></div>)}</div> : null}
          {record.documents?.length ? <div className="mt-5 border-t border-[#F3F4F6] pt-5"><h3 className="text-sm font-semibold">Reviewed document references</h3><div className="mt-3 flex flex-wrap gap-2">{record.documents.map((document) => <a key={document.url} href={document.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-[#E5E7EB] px-3 py-2 text-xs font-semibold">{sourceDisplayText(document.title)} <ExternalLink size={11} /></a>)}</div><p className="mt-3 text-[11px] text-[#9CA3AF]">A document link belongs to this case; its statements remain subject to field-level review.</p></div> : null}
        </article>)}</div><p className="mt-5 rounded-xl bg-stone-100 p-4 text-xs leading-5 text-stone-700">{sourceDisplayText(pilot.limitation)}</p></>}
    </PrivateWorkspaceGate></div>
  </div>;
}
