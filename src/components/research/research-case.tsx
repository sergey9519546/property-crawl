"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, Check, Clock3, Download, ExternalLink, FileCheck2, GitCompareArrows, History, Link2, Loader2, RotateCcw, Save, ShieldQuestion, Trash2 } from "lucide-react";
import { PrivateWorkspaceGate, useWorkspaceSession } from "@/components/workspace/workspace-shell";
import type { Claim, ReconsiderationCondition, ResearchCaseDetail, ResearchDossier } from "@/lib/workspace-types";
import { sourceDisplayText } from "@/lib/source-display";

type DetailResponse = { case: ResearchCaseDetail; dossier: ResearchDossier };
type IntakeItem = { id: string; sourceId: string; sourceUrl: string; capturedAt: string; review?: { decision?: string }; status?: string };

const reasonChoices = [
  ["price_above_target", "Price above target"],
  ["missing_sale_terms", "Missing sale terms"],
  ["title_risk_unresolved", "Title risk unresolved"],
  ["insufficient_margin", "Insufficient modeled margin"],
  ["property_condition", "Property condition"],
  ["timing_or_funds", "Timing or funds"],
] as const;
const relationships = ["sale_terms", "title_research", "occupancy_research", "valuation_research", "supports_identity", "other"];

function show(value: unknown) {
  if (value === null || value === undefined || value === "") return "Unknown";
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "string") return sourceDisplayText(value);
  return sourceDisplayText(JSON.stringify(value));
}

function claimName(claim: Claim) { return sourceDisplayText(claim.title || claim.key || "Recorded claim"); }

export function ResearchCase({ caseId }: { caseId: string }) {
  const session = useWorkspaceSession();
  const searchParams = useSearchParams();
  const requestedReturn = searchParams.get("returnTo");
  const returnTo = requestedReturn?.startsWith("/") && !requestedReturn.startsWith("//") ? requestedReturn : "/research";
  const [detail, setDetail] = React.useState<DetailResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [decisionState, setDecisionState] = React.useState<"inbox" | "pursue" | "pass">("inbox");
  const [reasonCodes, setReasonCodes] = React.useState<string[]>([]);
  const [note, setNote] = React.useState("");
  const [mode, setMode] = React.useState<"any" | "all">("any");
  const [conditions, setConditions] = React.useState<ReconsiderationCondition[]>([{ field: "openingBid", operator: "changed" }]);
  const [intake, setIntake] = React.useState<IntakeItem[]>([]);
  const [selectedEvidence, setSelectedEvidence] = React.useState("");
  const [relationship, setRelationship] = React.useState("sale_terms");

  const load = React.useCallback(async () => {
    if (!session.authenticated) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/workspace/cases/${encodeURIComponent(caseId)}`, { cache: "no-store", credentials: "same-origin" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Research case could not be loaded");
      setDetail(result); setError("");
      setDecisionState(result.case.state);
      setReasonCodes(result.case.decision?.reasonCodes || []);
      setNote(result.case.decision?.note || "");
      if (result.case.reconsideration?.conditions?.length) { setMode(result.case.reconsideration.mode); setConditions(result.case.reconsideration.conditions); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Research case could not be loaded"); }
    finally { setLoading(false); }
  }, [caseId, session.authenticated]);

  React.useEffect(() => { void load(); }, [load]);

  async function mutate(path: string, method: string, body: unknown) {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(path, { method, credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Case update failed");
      await load(); return result;
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Case update failed"); return null; }
    finally { setBusy(false); }
  }

  async function saveDecision() {
    if (!detail) return;
    const result = await mutate(`/api/workspace/cases/${encodeURIComponent(caseId)}`, "PATCH", {
      expectedRevision: detail.case.revision,
      state: decisionState,
      reasonCodes: decisionState === "inbox" ? [] : reasonCodes,
      note: note || undefined,
      ...(decisionState === "pass" ? { reconsideration: { mode, conditions } } : {}),
    });
    if (result) setMessage(decisionState === "pass" ? "Pass saved. The case returns only when a supported condition is met." : "Decision saved to this case revision.");
  }

  async function loadEvidence() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/source-network/intake?includeContent=false", { cache: "no-store", credentials: "same-origin" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Evidence queue could not be loaded");
      const approved = (result.items || []).filter((item: IntakeItem) => item.review?.decision === "approved");
      setIntake(approved); if (approved[0]) setSelectedEvidence(approved[0].id);
      setMessage(approved.length ? `${approved.length} reviewed evidence packet${approved.length === 1 ? "" : "s"} available.` : "No approved evidence packets are available to link.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Evidence queue could not be loaded"); }
    finally { setBusy(false); }
  }

  async function linkEvidence() {
    if (!detail || !selectedEvidence) return;
    const result = await mutate(`/api/workspace/cases/${encodeURIComponent(caseId)}/evidence`, "POST", { expectedRevision: detail.case.revision, intakeId: selectedEvidence, relationship });
    if (result) setMessage("Reviewed evidence linked. Its contents remain an attachment until an official-record adapter establishes a fact.");
  }

  async function unlinkEvidence(intakeId: string) {
    if (!detail) return;
    const result = await mutate(`/api/workspace/cases/${encodeURIComponent(caseId)}/evidence/${encodeURIComponent(intakeId)}`, "DELETE", { expectedRevision: detail.case.revision });
    if (result) setMessage("Evidence reference removed from the new case revision.");
  }

  async function downloadPacket(format: "json" | "md") {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/workspace/cases/${encodeURIComponent(caseId)}/packet?format=${format}`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) { const result = await response.json(); throw new Error(result.error || "Packet could not be generated"); }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `property-research-${caseId}-r${detail?.case.revision || "current"}.${format === "md" ? "md" : "json"}`; anchor.click();
      URL.revokeObjectURL(url); setMessage("Packet generated from the current stored case revision.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Packet could not be generated"); }
    finally { setBusy(false); }
  }

  return <div className="mx-auto max-w-[1380px] px-5 py-8 sm:px-8">
    <Link href={returnTo} className="inline-flex items-center gap-2 text-xs font-semibold text-[#6B7280] hover:text-[#0F172A]"><ArrowLeft size={14} />Back to research</Link>
    <PrivateWorkspaceGate title="Unlock this research case">
      {loading && !detail ? <p className="mt-6 flex items-center gap-2 rounded-2xl bg-white p-7 text-sm"><Loader2 size={17} className="animate-spin" />Reconstructing the case…</p> : error && !detail ? <p role="alert" className="mt-6 rounded-2xl bg-amber-100 p-6 text-sm text-amber-950">{error}</p> : detail && <>
        <header className="mt-6 rounded-3xl bg-[#0F172A] p-6 text-white sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-5"><div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider">{detail.case.state}</span>{detail.case.reconsiderationRequired && <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-900"><RotateCcw size={12} />Second Look</span>}</div><h1 className="mt-4 text-3xl font-semibold sm:text-5xl">{sourceDisplayText(detail.case.address || detail.case.listingId)}</h1><p className="mt-3 text-xs text-slate-200/70">{sourceDisplayText(detail.case.sourceRef.sourceId)} · {sourceDisplayText(detail.case.sourceRef.recordId)} · Case revision {detail.case.revision}</p></div><div className="flex flex-wrap gap-2"><button disabled={busy} onClick={() => void downloadPacket("json")} className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-semibold text-[#0F172A]"><Download size={14} />JSON</button><button disabled={busy} onClick={() => void downloadPacket("md")} className="inline-flex items-center gap-2 rounded-lg border border-white/25 px-3 py-2 text-xs font-semibold"><Download size={14} />Print-ready report</button></div></div>
          {detail.case.reconsiderationRequired && <p className="mt-5 rounded-xl bg-slate-800 p-4 text-sm leading-6 text-slate-200">Relevant evidence changed. Your saved pass remains intact until you review and save a new decision.</p>}
        </header>
        {error && <p role="alert" className="mt-4 rounded-xl bg-amber-100 p-4 text-sm text-amber-950">{error}</p>}{message && <p role="status" className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-950"><Check size={16} />{message}</p>}

        <div className="mt-6 grid items-start gap-6 xl:grid-cols-[1fr_390px]">
          <div className="space-y-6">
            <section className="rounded-2xl border border-[#E5E7EB] bg-white p-5 sm:p-7"><div className="flex items-center gap-2"><GitCompareArrows size={19} className="text-slate-900" /><h2 className="text-xl font-semibold">Evidence comparison</h2></div><p className="mt-2 text-xs leading-5 text-[#6B7280]">Publisher claims and matched official-record claims remain separate. A blank side means the evidence is still unknown.</p><div className="mt-5 grid gap-4 md:grid-cols-2"><ClaimColumn title="Publisher record" claims={detail.dossier.claimGroups?.publisher || []} empty="No publisher claims were retained in this dossier snapshot." /><ClaimColumn title="Official records" claims={detail.dossier.claimGroups?.official || []} empty="No parcel-level official record has been matched." /></div>{(detail.dossier.signals || []).length > 0 && <div className="mt-5 border-t border-[#F3F4F6] pt-5"><h3 className="text-sm font-semibold">Conflicts and cautions</h3><div className="mt-3 space-y-2">{detail.dossier.signals?.map((signal, index) => <div key={index} className="rounded-xl bg-amber-50 p-4 text-xs leading-5 text-amber-950"><p className="font-semibold">{sourceDisplayText(signal.title || signal.type || "Evidence signal")}</p><p className="mt-1">{sourceDisplayText(signal.reason || "Review the underlying evidence.")}</p></div>)}</div></div>}</section>

            <section className="rounded-2xl border border-[#E5E7EB] bg-white p-5 sm:p-7"><div className="flex items-center gap-2"><ShieldQuestion size={19} className="text-slate-900" /><h2 className="text-xl font-semibold">What to investigate next</h2></div><div className="mt-4 space-y-3">{(detail.dossier.gaps || []).map((gap, index) => <article key={gap.key || index} className="rounded-xl bg-[#F1F5F9] p-4"><h3 className="text-sm font-semibold">{sourceDisplayText(gap.title || gap.key || "Open question")}</h3><p className="mt-2 text-xs leading-5 text-[#6B7280]">{sourceDisplayText(gap.reason || "Supporting evidence has not been linked.")}</p>{gap.nextAction && <p className="mt-2 text-xs font-semibold text-emerald-700">Next: {sourceDisplayText(gap.nextAction)}</p>}</article>)}{!(detail.dossier.gaps || []).length && <p className="text-sm text-[#6B7280]">No open questions were recorded in this snapshot. Recheck source freshness before acting.</p>}</div></section>

            <section className="rounded-2xl border border-[#E5E7EB] bg-white p-5 sm:p-7"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><FileCheck2 size={19} className="text-slate-900" /><h2 className="text-xl font-semibold">Reviewed evidence</h2></div><button type="button" disabled={busy} onClick={() => void loadEvidence()} className="rounded-lg border border-[#E5E7EB] px-3 py-2 text-xs font-semibold">Load review queue</button></div><div className="mt-4 space-y-3">{detail.case.evidenceLinks.map((link) => <article key={link.intakeId} className="rounded-xl bg-[#F1F5F9] p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold">{sourceDisplayText(link.relationship.replaceAll("_", " "))}</p><a href={link.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 break-all text-xs text-slate-900 underline hover:text-slate-700">Open exact evidence <ExternalLink size={12} /></a><p className="mt-2 text-[10px] text-[#9CA3AF]">SHA-256 {link.contentSha256}</p></div><button type="button" aria-label="Unlink evidence" disabled={busy} onClick={() => void unlinkEvidence(link.intakeId)} className="rounded-lg p-2 hover:bg-white"><Trash2 size={15} /></button></div></article>)}{!detail.case.evidenceLinks.length && <p className="text-sm text-[#6B7280]">No reviewed attachments are linked.</p>}</div>{intake.length > 0 && <div className="mt-5 grid gap-2 border-t border-[#F3F4F6] pt-5 sm:grid-cols-[1fr_180px_auto]"><select aria-label="Reviewed evidence packet" value={selectedEvidence} onChange={(event) => setSelectedEvidence(event.target.value)} className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-xs">{intake.map((item) => <option key={item.id} value={item.id}>{sourceDisplayText(item.sourceId)} · {item.id}</option>)}</select><select aria-label="Evidence relationship" value={relationship} onChange={(event) => setRelationship(event.target.value)} className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-xs">{relationships.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select><button type="button" disabled={busy || !selectedEvidence} onClick={() => void linkEvidence()} className="inline-flex items-center justify-center gap-1 rounded-lg bg-[#0F172A] px-3 py-2 text-xs font-semibold text-white"><Link2 size={13} />Link</button></div>}<p className="mt-4 text-[11px] leading-5 text-[#9CA3AF]">Attachment review confirms the file and source reference were reviewed. It does not make every extracted statement a verified property fact.</p></section>

            <section className="rounded-2xl border border-[#E5E7EB] bg-white p-5 sm:p-7"><div className="flex items-center gap-2"><History size={19} className="text-slate-900" /><h2 className="text-xl font-semibold">Observation and decision timeline</h2></div><ol className="mt-5 space-y-4">{detail.case.timeline.map((entry, index) => <li key={entry.id || index} className="relative border-l-2 border-[#E5E7EB] pl-5"><span className="absolute -left-[6px] top-1 h-2.5 w-2.5 rounded-full bg-[#0F172A]" /><p className="text-xs font-semibold">{sourceDisplayText(entry.type.replaceAll("_", " "))}</p><p className="mt-1 text-[11px] text-[#9CA3AF]">{new Date(entry.at).toLocaleString()} · Revision {entry.revision || "—"}</p></li>)}</ol></section>
          </div>

          <aside className="rounded-2xl border border-[#E5E7EB] bg-white p-5 xl:sticky xl:top-24"><h2 className="text-xl font-semibold">Record your decision</h2><p className="mt-2 text-xs leading-5 text-[#6B7280]">The decision and its reasons are versioned with the same evidence snapshot used by exports.</p><div className="mt-5 grid grid-cols-3 gap-2">{(["inbox", "pursue", "pass"] as const).map((value) => <button key={value} type="button" aria-pressed={decisionState === value} onClick={() => setDecisionState(value)} className={`rounded-lg px-3 py-2.5 text-xs font-semibold capitalize ${decisionState === value ? "bg-[#0F172A] text-white" : "border border-[#E5E7EB]"}`}>{value}</button>)}</div>
            {decisionState !== "inbox" && <fieldset className="mt-5"><legend className="text-xs font-semibold">Reasons {decisionState === "pass" ? "(choose at least one)" : ""}</legend><div className="mt-3 space-y-2">{reasonChoices.map(([value, title]) => <label key={value} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={reasonCodes.includes(value)} onChange={(event) => setReasonCodes(event.target.checked ? [...reasonCodes, value] : reasonCodes.filter((item) => item !== value))} />{title}</label>)}</div></fieldset>}
            <label className="mt-5 block text-xs font-semibold">Decision note<textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} rows={4} className="mt-2 w-full rounded-lg border border-[#E5E7EB] p-3 text-sm font-normal" placeholder="What matters, what is unresolved, and what you will verify." /></label>
            {decisionState === "pass" && <div className="mt-5 border-t border-[#F3F4F6] pt-5"><div className="flex items-center gap-2"><RotateCcw size={16} className="text-slate-900" /><h3 className="text-sm font-semibold">Bring it back when…</h3></div><select aria-label="Reconsideration matching" value={mode} onChange={(event) => setMode(event.target.value as "any" | "all")} className="mt-3 w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-xs"><option value="any">Any condition matches</option><option value="all">Every condition matches</option></select><div className="mt-3 space-y-3">{conditions.map((condition, index) => <ConditionEditor key={index} condition={condition} onChange={(next) => setConditions(conditions.map((item, itemIndex) => itemIndex === index ? next : item))} onRemove={conditions.length > 1 ? () => setConditions(conditions.filter((_, itemIndex) => itemIndex !== index)) : undefined} />)}</div><button type="button" disabled={conditions.length >= 10} onClick={() => setConditions([...conditions, { field: "saleDate", operator: "changed" }])} className="mt-3 text-xs font-semibold text-slate-900 underline hover:text-slate-700 disabled:opacity-50">Add return condition</button></div>}
            <button type="button" disabled={busy || (decisionState === "pass" && reasonCodes.length === 0)} onClick={() => void saveDecision()} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#0F172A] px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}Save decision</button>
            <div className="mt-5 rounded-xl bg-[#F1F5F9] p-4 text-xs leading-5 text-[#6B7280]"><p className="flex items-center gap-2 font-semibold text-[#0F172A]"><Clock3 size={14} />Reproducible revision</p><p className="mt-1">Packets generated now use case revision {detail.case.revision}. Changed inputs create a new revision; earlier timeline entries remain.</p></div>
          </aside>
        </div>
      </>}
    </PrivateWorkspaceGate>
  </div>;
}

function ClaimColumn({ title, claims, empty }: { title: string; claims: Claim[]; empty: string }) {
  return <div className="rounded-xl border border-[#E5E7EB] p-4"><h3 className="text-sm font-semibold">{title}</h3><dl className="mt-3 space-y-3">{claims.map((claim, index) => <div key={`${claim.key || claim.title}-${index}`}><dt className="text-[10px] font-bold uppercase tracking-wider text-[#9CA3AF]">{claimName(claim)}</dt><dd className="mt-1 break-words text-sm font-semibold">{show(claim.value)}</dd>{claim.sourceUrl && <a href={claim.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[10px] text-slate-900 underline hover:text-slate-700">Source <ExternalLink size={10} /></a>}</div>)}{!claims.length && <p className="text-xs leading-5 text-[#9CA3AF]">{empty}</p>}</dl></div>;
}

function ConditionEditor({ condition, onChange, onRemove }: { condition: ReconsiderationCondition; onChange: (value: ReconsiderationCondition) => void; onRemove?: () => void }) {
  const numeric = condition.field === "openingBid" || condition.field === "sqft";
  const evidence = condition.field === "requiredEvidence";
  const operatorOptions = evidence ? [["available", "becomes available"]] : numeric ? [["changed", "changes"], ["lte", "is at most"], ["gte", "is at least"]] : [["changed", "changes"]];
  return <div className="rounded-xl bg-[#F1F5F9] p-3"><div className="flex gap-2"><select aria-label="Reconsideration field" value={condition.field} onChange={(event) => { const field = event.target.value as ReconsiderationCondition["field"]; onChange(field === "requiredEvidence" ? { field, operator: "available", value: "any" } : { field, operator: "changed" }); }} className="min-w-0 flex-1 rounded-lg border border-[#E5E7EB] bg-white px-2 py-2 text-xs"><option value="openingBid">Opening amount</option><option value="saleDate">Sale date</option><option value="status">Published status</option><option value="sqft">Building area</option><option value="requiredEvidence">Required evidence</option></select>{onRemove && <button type="button" aria-label="Remove condition" onClick={onRemove} className="rounded-lg px-2 hover:bg-white"><Trash2 size={14} /></button>}</div><select aria-label="Reconsideration operator" value={condition.operator} onChange={(event) => { const operator = event.target.value as ReconsiderationCondition["operator"]; onChange({ field: condition.field, operator, ...(operator === "lte" || operator === "gte" ? { value: typeof condition.value === "number" ? condition.value : 0 } : operator === "available" ? { value: typeof condition.value === "string" ? condition.value : "any" } : {}) }); }} className="mt-2 w-full rounded-lg border border-[#E5E7EB] bg-white px-2 py-2 text-xs">{operatorOptions.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select>{(condition.operator === "lte" || condition.operator === "gte") && <input aria-label="Reconsideration threshold" type="number" min={0} value={typeof condition.value === "number" ? condition.value : 0} onChange={(event) => onChange({ ...condition, value: Number(event.target.value) })} className="mt-2 w-full rounded-lg border border-[#E5E7EB] bg-white px-2 py-2 text-xs" />}{condition.operator === "available" && <select aria-label="Required evidence type" value={typeof condition.value === "string" ? condition.value : "any"} onChange={(event) => onChange({ ...condition, value: event.target.value })} className="mt-2 w-full rounded-lg border border-[#E5E7EB] bg-white px-2 py-2 text-xs"><option value="any">Any reviewed evidence</option><option value="sale_terms">Sale terms</option><option value="title_research">Title research</option><option value="occupancy_research">Occupancy research</option><option value="valuation_research">Valuation research</option></select>}</div>;
}
