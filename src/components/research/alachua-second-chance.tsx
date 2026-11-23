"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Building2, Download, ExternalLink, FileCheck2, LandPlot, Loader2, MapPinned, RefreshCw, Search } from "lucide-react";
import { PrivateWorkspaceGate, useWorkspaceSession } from "@/components/workspace/workspace-shell";
import { useLocale } from "@/components/i18n/locale-provider";
import { localizePropType } from "@/lib/i18n/domain";
import { formatLocaleDate, formatUsd, interpolate } from "@/lib/i18n/translator";
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

const words = (value: string) => sourceDisplayText(value.replaceAll("_", " "));

export function AlachuaSecondChance() {
  const { locale, messages } = useLocale();
  const t = messages.researchB2;
  const fmtMoney = (value: unknown) =>
    typeof value === "number"
      ? (locale === "en" ? value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }) : formatUsd(locale, value))
      : t.alUnknown;
  const fmtShortDate = (value: string) => (locale === "en" ? new Date(value).toLocaleDateString() : formatLocaleDate(locale, value));
  const fmtDateTime = (value: string) => (locale === "en" ? new Date(value).toLocaleString() : formatLocaleDate(locale, value, { dateStyle: "medium", timeStyle: "short" }));

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
      if (!response.ok) throw new Error(result.error || t.alErrLoadIntake);
      const items = (result.items || []).filter((item: Intake) => item.sourceId === "alachua-tax-deeds" && item.review?.decision === "approved");
      setIntake(items); if (items[0] && !selected) setSelected(items[0].id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : t.alErrLoadIntake); }
    finally { setBusy(false); }
  }, [selected, session.authenticated, t.alErrLoadIntake]);

  React.useEffect(() => { void loadIntake(); }, [loadIntake]);

  async function build(lookupParcels: boolean) {
    if (!selected) { setError(t.alErrSelectPacket); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/workspace/alachua/pilot", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ intakeId: selected, lookupParcels, maxParcelLookups: 5 }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || t.alErrBuildReview);
      setPilot(result.pilot);
      setMessage(
        lookupParcels
          ? interpolate(result.pilot.parcelLookups === 1 ? t.alMsgParcelLookupSingle : t.alMsgParcelLookupPlural, { count: result.pilot.parcelLookups })
          : t.alMsgPacketOffline,
      );
    } catch (caught) { setError(caught instanceof Error ? caught.message : t.alErrBuildReview); }
    finally { setBusy(false); }
  }

  function download() {
    if (!pilot) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(pilot, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `alachua-second-chance-${pilot.packetId}.json`; anchor.click(); URL.revokeObjectURL(url);
  }

  return <div className="mx-auto max-w-[1380px] px-5 py-9 sm:px-8">
    <Link href="/research" className="inline-flex items-center gap-2 text-xs font-semibold text-ink-3"><ArrowLeft size={14} />{t.alBackInbox}</Link>
    <div className="mt-6 grid items-end gap-6 lg:grid-cols-[1fr_380px]"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-ink-2">{t.alKicker}</p><h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-6xl">{t.alHeading}</h1><p className="mt-4 max-w-3xl text-sm leading-7 text-ink-2">{t.alSubtitle}</p></div><div className="rounded-card bg-ink p-5 text-xs leading-6 text-paper/85"><strong className="block text-white">{t.alBoundaryTitle}</strong>{t.alBoundaryBody}</div></div>
    <div className="mt-8"><PrivateWorkspaceGate allowMember title={t.alGateTitle}>
      <section className="rounded-card border border-line bg-card p-5"><div className="flex flex-wrap items-end gap-3"><label className="min-w-[260px] flex-1 text-xs font-semibold">{t.alPacketLabel}<select value={selected} onChange={(event) => { setSelected(event.target.value); setPilot(null); }} className="mt-2 w-full rounded-control border border-line-strong bg-card px-3 py-3 text-sm font-normal"><option value="">{t.alChooseImport}</option>{intake.map((item) => <option key={item.id} value={item.id}>{interpolate(t.alOptionCaptured, { id: item.id, date: fmtShortDate(item.capturedAt) })}</option>)}</select></label><button type="button" disabled={busy} onClick={() => void loadIntake()} className="inline-flex items-center gap-2 rounded-control border border-line px-4 py-3 text-xs font-semibold"><RefreshCw size={14} />{t.alReloadPackets}</button><button type="button" disabled={busy || !selected} onClick={() => void build(false)} className="inline-flex items-center gap-2 rounded-control bg-ink px-4 py-3 text-xs font-semibold text-white hover:bg-ink-2">{busy ? <Loader2 size={14} className="animate-spin" /> : <FileCheck2 size={14} />}{t.alBuildCases}</button><button type="button" disabled={busy || !selected} onClick={() => void build(true)} className="inline-flex items-center gap-2 rounded-control bg-ink px-4 py-3 text-xs font-semibold text-white hover:bg-ink-2"><Search size={14} />{t.alResearch5Parcels}</button></div><p className="mt-3 text-xs leading-5 text-ink-3">{t.alActionNote}</p></section>
      {error && <p role="alert" className="mt-4 rounded-control bg-catch-wash p-4 text-sm text-catch-ink">{error}</p>}{message && <p role="status" className="mt-4 rounded-control border border-go/30 bg-go-wash p-4 text-sm text-ink">{message}</p>}
      {!intake.length && !busy && <div className="mt-5 rounded-card border border-dashed border-line bg-card p-7"><AlertTriangle className="text-catch" /><h2 className="mt-4 text-xl font-semibold">{t.alEmptyTitle}</h2><p className="mt-2 text-sm leading-6 text-ink-2">{t.alEmptyBody}</p><Link href="/sources" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-ink underline hover:text-ink-2">{t.alOpenSources} <ExternalLink size={14} /></Link></div>}
      {pilot && <><div className="mt-5 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-ink-3">{interpolate(pilot.records.length === 1 ? t.alReviewedCaseSingle : t.alReviewedCasePlural, { count: pilot.records.length })} · {words(pilot.coverage)} · {interpolate(t.alCountyCompleteness, { status: pilot.completeCountyInventory ? t.alVerified : t.alNotEstablished })}</p><button type="button" onClick={download} className="inline-flex items-center gap-2 rounded-control border border-line bg-card px-3 py-2 text-xs font-semibold"><Download size={14} />{t.alExportReview}</button></div><div className="mt-4 space-y-5">{pilot.records.map((record) => <article key={record.sourceRef.recordId} className="rounded-card border border-line bg-card p-5 sm:p-7"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap gap-2"><span className={`rounded-full px-2.5 py-1 text-label font-bold uppercase ${record.status === "available_for_public" ? "bg-go-wash text-go" : "bg-catch-wash text-catch-ink"}`}>{words(record.status)}</span><span className="rounded-full bg-paper px-2.5 py-1 text-label font-bold uppercase text-ink-2">{words(record.freshness)}</span></div><h2 className="mt-3 text-2xl font-semibold">{interpolate(t.alCasePrefix, { number: sourceDisplayText(record.caseNumber) })}</h2><p className="mt-2 text-xs text-ink-3">{sourceDisplayText(record.sourceRef.sourceId)} · {sourceDisplayText(record.sourceRef.recordId)} · {interpolate(t.alObservedAt, { date: fmtDateTime(record.observedAt) })}</p></div><p className="rounded-control bg-catch-wash p-3 text-xs font-semibold text-catch-ink">{t.alQuoteUnresolved}</p></div>
          <div className="mt-5 grid gap-4 lg:grid-cols-3"><div className="rounded-control bg-paper p-4"><p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider"><LandPlot size={15} />{t.alParcelIdentity}</p><p className="mt-3 break-all text-sm font-semibold">{record.rawParcelIds.join(", ")}</p><p className="mt-2 text-xs text-ink-3">{t.alParcelIdentityNote}</p></div><div className="rounded-control bg-paper p-4"><p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider"><Building2 size={15} />{t.alOfferingDesc}</p><p className="mt-3 text-sm font-semibold">{record.advertisedPropertyType ? (localizePropType(record.advertisedPropertyType, messages, locale) || record.advertisedPropertyType) : t.alUnknown}</p><p className="mt-2 text-xs text-ink-3">{t.alOfferingNote}</p></div><div className="rounded-control bg-paper p-4"><p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider"><MapPinned size={15} />{t.alParcelResearch}</p><p className="mt-3 text-sm font-semibold">{interpolate((record.parcels?.length || 0) === 1 ? t.alAdapterRespSingle : t.alAdapterRespPlural, { count: record.parcels?.length || 0 })}</p><div className="mt-2 space-y-1">{record.parcelMaps?.map((map) => map.propertyAppraiserUrl ? <a key={map.rawParcelId} href={map.propertyAppraiserUrl} target="_blank" rel="noreferrer" className="block text-xs text-yours underline hover:text-ink">{interpolate(t.alOfficialParcel, { id: map.rawParcelId })}</a> : null)}</div></div></div>
          <div className="mt-5 grid gap-5 lg:grid-cols-2"><div><h3 className="text-sm font-semibold">{t.alCostComponents}</h3><dl className="mt-3 divide-y divide-line rounded-control border border-line">{Object.entries(record.purchaseTerms.components).map(([key, value]) => <div key={key} className="flex justify-between gap-4 p-3 text-xs"><dt className="text-ink-3">{words(key)}</dt><dd className="font-semibold">{fmtMoney(value)}</dd></div>)}</dl></div><div><h3 className="text-sm font-semibold">{t.alStatusHistory}</h3><ol className="mt-3 space-y-2">{record.statusHistory?.map((item, index) => <li key={`${item.observedAt}-${index}`} className="rounded-control border border-line p-3 text-xs"><p className="font-semibold">{sourceDisplayText(item.rawStatus)}</p><p className="mt-1 text-ink-3">{fmtDateTime(item.observedAt)}</p></li>)}{!record.statusHistory?.length && <li className="text-xs text-ink-3">{t.alNoEarlierObs}</li>}</ol></div></div>
          {(record.signals?.length || record.issues?.length) ? <div className="mt-5 grid gap-3 lg:grid-cols-2">{record.signals?.map((signal) => <div key={signal.id} className="rounded-control bg-paper p-4 text-xs leading-5 text-ink"><p className="font-semibold">{sourceDisplayText(signal.title)}</p><p className="mt-1">{sourceDisplayText(signal.explanation || t.alSignalFallback)}</p>{signal.nextAction && <p className="mt-2 font-semibold">{t.alNextPrefix} {sourceDisplayText(signal.nextAction)}</p>}</div>)}{record.issues?.map((issue, index) => <div key={`${issue.code}-${index}`} className="rounded-control bg-catch-wash p-4 text-xs leading-5 text-catch-ink"><p className="font-semibold">{words(issue.code)}</p><p className="mt-1">{sourceDisplayText(issue.message)}</p></div>)}</div> : null}
          {record.documents?.length ? <div className="mt-5 border-t border-line pt-5"><h3 className="text-sm font-semibold">{t.alReviewedDocs}</h3><div className="mt-3 flex flex-wrap gap-2">{record.documents.map((document) => <a key={document.url} href={document.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-control border border-line px-3 py-2 text-xs font-semibold">{sourceDisplayText(document.title)} <ExternalLink size={11} /></a>)}</div><p className="mt-3 text-xs text-ink-3">{t.alReviewedDocsNote}</p></div> : null}
        </article>)}</div><p className="mt-5 rounded-control bg-paper p-4 text-xs leading-5 text-ink-2">{sourceDisplayText(pilot.limitation)}</p></>}
    </PrivateWorkspaceGate></div>
  </div>;
}
