"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, Calculator, Check, Clock3, Download, ExternalLink, FileCheck2, Gavel, GitCompareArrows, History, Link2, Loader2, RotateCcw, Save, Scale, ShieldAlert, ShieldCheck, ShieldQuestion, Trash2 } from "lucide-react";
import { readUnderwriteScenario } from "@/lib/underwrite-scenario";
import { PrivateWorkspaceGate, useWorkspaceSession } from "@/components/workspace/workspace-shell";
import type { Claim, ReconsiderationCondition, ResearchCaseDetail, ResearchDossier } from "@/lib/workspace-types";
import { sourceDisplayText } from "@/lib/source-display";
import { listingCatch } from "@/lib/listing-catch";
import { bandForScore } from "@/lib/score-bands";
import { evaluateAdversarialDocket } from "@/lib/adversarial-docket";
import { cn } from "@/lib/utils";

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

  // Re-POSTing the listing upserts this case; the server keeps the newer snapshot.
  async function recheckSource() {
    if (!detail) return;
    const local = readUnderwriteScenario(detail.case.listingId);
    const result = await mutate("/api/workspace/cases", "POST", {
      listingId: detail.case.listingId,
      origin: { type: "manual" },
      ...(local ? { underwriteScenario: local } : {}),
    });
    if (result) setMessage(result.sourceCheck?.updated === true ? "A newer saved publisher observation was found and the snapshot was updated." : "No newer saved publisher observation was found. This check does not contact the publisher.");
  }

  async function syncLocalScenario() {
    if (!detail) return;
    const local = readUnderwriteScenario(detail.case.listingId);
    if (!local) return;
    const result = await mutate("/api/workspace/cases", "POST", {
      listingId: detail.case.listingId,
      origin: { type: "manual" },
      underwriteScenario: local,
    });
    if (result) setMessage("Local underwriting assumptions synced to research case.");
  }

  async function saveDecision() {
    if (!detail) return;
    const local = readUnderwriteScenario(detail.case.listingId);
    const scenarioToPersist = local || detail.case.underwriteScenario || undefined;
    const result = await mutate(`/api/workspace/cases/${encodeURIComponent(caseId)}`, "PATCH", {
      expectedRevision: detail.case.revision,
      state: decisionState,
      reasonCodes: decisionState === "inbox" ? [] : reasonCodes,
      note: note || undefined,
      ...(scenarioToPersist ? { underwriteScenario: scenarioToPersist } : {}),
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
    <Link href={returnTo} className="inline-flex items-center gap-2 text-xs font-semibold text-ink-2 hover:text-ink"><ArrowLeft size={14} />Back to research</Link>
    <PrivateWorkspaceGate title="Unlock this research case" headingLevel={1}>
      {loading && !detail
        ? <>
            {/* The h1 belongs to the loaded branch below, so these states used
                to render a bare <p> with no page-level heading at all -- three
                of this page's four states gave a screen-reader user nothing to
                navigate from. Measured as h1=0 on /research/[id] while every
                other route in the app reported h1=1. */}
            <h1 className="mt-6 text-2xl font-semibold text-ink">Reconstructing this research case</h1>
            <p className="mt-3 flex items-center gap-2 rounded-card bg-card p-7 text-sm"><Loader2 size={17} className="animate-spin" />Gathering the evidence recorded for this case…</p>
          </>
        : error && !detail
          ? <>
              <h1 className="mt-6 text-2xl font-semibold text-ink">This research case could not be opened</h1>
              <p role="alert" className="mt-3 rounded-card bg-catch-wash p-6 text-sm text-catch-ink">{error}</p>
            </>
          : detail && <>
        <header className="mt-6 rounded-card bg-ink p-6 text-white sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-5"><div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-card/10 px-3 py-1 text-label font-bold uppercase tracking-wider">{detail.case.state}</span>{detail.case.reconsiderationRequired && <span className="flex items-center gap-1 rounded-full bg-signature px-3 py-1 text-label font-bold uppercase tracking-wider text-ink"><RotateCcw size={12} />Second Look</span>}</div><h1 className="mt-4 text-3xl font-semibold sm:text-5xl">{sourceDisplayText(detail.case.address || detail.case.listingId)}</h1><p className="mt-3 text-xs text-paper/75">{sourceDisplayText(detail.case.sourceRef.sourceId)} · {sourceDisplayText(detail.case.sourceRef.recordId)} · Case revision {detail.case.revision}</p></div><div className="flex flex-wrap gap-2"><Link href={`/research/${encodeURIComponent(caseId)}/export`} className="inline-flex items-center gap-2 rounded-control border border-white/25 px-3 py-2 text-xs font-semibold">Decision packet dossier</Link><button type="button" aria-label="Download JSON decision packet" disabled={busy} onClick={() => void downloadPacket("json")} className="inline-flex items-center gap-2 rounded-control bg-card px-3 py-2 text-xs font-semibold text-ink"><Download size={14} />JSON</button><button type="button" aria-label="Download print-ready decision report" disabled={busy} onClick={() => void downloadPacket("md")} className="inline-flex items-center gap-2 rounded-control border border-white/25 px-3 py-2 text-xs font-semibold"><Download size={14} />Print-ready report</button></div></div>
          {detail.case.reconsiderationRequired && (
            <div className="mt-5 rounded-control bg-ink-2 p-4 text-sm leading-6 text-paper">
              <p>Relevant evidence changed. Your saved pass remains intact until you review and save a new decision.</p>
              {(detail.case.latestTrigger?.matchedConditions || []).length > 0 && (
                <ul data-testid="matched-conditions" className="mt-2 list-disc pl-5 text-xs text-paper/80">
                  {detail.case.latestTrigger!.matchedConditions!.map((condition, index) => (
                    <li key={index}>
                      {sourceDisplayText(String(condition.field))} {sourceDisplayText(String(condition.operator).replace(/_/g, " "))}
                      {"value" in condition && condition.value !== undefined ? ` ${sourceDisplayText(String(condition.value))}` : ""}
                    </li>
                  ))}
                </ul>
              )}

              {/* Title Risk & Senior Lien Survival Second-Look Alerts */}
              {(detail.case.latestTrigger?.titleRiskAlert === "JUNIOR_LIEN_SURVIVING_MORTGAGE" || detail.case.latestTrigger?.alerts?.includes("JUNIOR_LIEN_SURVIVING_MORTGAGE")) && (
                <div data-testid="junior-lien-survival-alert" className="mt-3 rounded-control border border-catch/50 bg-catch/15 p-3.5 text-xs text-paper">
                  <div className="flex items-start gap-2">
                    <ShieldAlert size={16} className="mt-0.5 shrink-0 text-catch" />
                    <div>
                      <strong className="block font-bold uppercase tracking-wider text-white">
                        CRITICAL TITLE ALERT: Junior Lien Surviving Mortgage Trap (JUNIOR_LIEN_SURVIVING_MORTGAGE)
                      </strong>
                      <p className="mt-1 leading-relaxed text-paper/90">
                        Apparent price drop is a value trap. The foreclosing plaintiff is a subordinate lienholder (2nd Mortgage, HELOC, or Mechanic&apos;s Lien). Under common law recording acts, the senior 1st mortgage survives the auction in full against the winning bidder!
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {(detail.case.latestTrigger?.irsRedemptionActive || detail.case.latestTrigger?.flags?.includes("IRS_REDEMPTION_WINDOW_ACTIVE")) && (
                <div data-testid="irs-redemption-alert" className="mt-3 rounded-control border border-catch/40 bg-catch/10 p-3.5 text-xs text-paper">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0 text-catch" />
                    <div>
                      <strong className="block font-bold uppercase tracking-wider text-white">
                        CASE FLAG: IRS 120-Day Redemption Window Active (IRS_REDEMPTION_WINDOW_ACTIVE)
                      </strong>
                      <p className="mt-1 leading-relaxed text-paper/90">
                        Active federal tax lien recorded under 26 U.S.C. § 7425(d). The United States holds a statutory 120-day super-priority post-sale right of redemption.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {(detail.case.latestTrigger?.hoaSuperPriorityRisk || detail.case.latestTrigger?.flags?.includes("HOA_SUPER_PRIORITY_RISK")) && (
                <div data-testid="hoa-super-priority-alert" className="mt-3 rounded-control border border-yours/50 bg-yours/15 p-3.5 text-xs text-paper">
                  <div className="flex items-start gap-2">
                    <Scale size={16} className="mt-0.5 shrink-0 text-yours-wash" />
                    <div>
                      <strong className="block font-bold uppercase tracking-wider text-white">
                        CASE FLAG: HOA Super-Priority Assessment Risk (HOA_SUPER_PRIORITY_RISK)
                      </strong>
                      <p className="mt-1 leading-relaxed text-paper/90">
                        Property is in a statutory super-priority state (UCIOA / NV / FL). Common expense assessments hold statutory priority over private deeds; verify whether senior mortgage is extinguished (NV NRS 116.3116) or survives with safe harbor payoffs.
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          {(() => { const snap = detail.case.listingSnapshot as Parameters<typeof listingCatch>[0]; const band = bandForScore(snap.dealScore); const catchSummary = listingCatch(snap); return <section data-testid="case-catch" className="mt-5 rounded-control bg-card/5 p-4 text-sm leading-6 text-paper"><p className="font-semibold">{band ? `Deal Score ${Math.round(Number(snap.dealScore))}/99 · ${band.label}` : "Deal Score unavailable"} · {catchSummary.flags.length ? `${catchSummary.flags.length} thing${catchSummary.flags.length === 1 ? "" : "s"} to check` : "no published red flags"}</p><p className="mt-1 text-xs text-paper/80">{sourceDisplayText([...catchSummary.notes, ...catchSummary.flags].join(" "))}</p></section>; })()}
        </header>
        {error && <p role="alert" className="mt-4 rounded-control bg-catch-wash p-4 text-sm text-catch-ink">{error}</p>}{message && <p role="status" className="mt-4 flex items-center gap-2 rounded-control border border-go/30 bg-go-wash p-4 text-sm text-ink"><Check size={16} />{message}</p>}

        <div className="mt-6 grid items-start gap-6 xl:grid-cols-[1fr_390px]">
          <div className="space-y-6">
            {/* Title Risk & Senior Lien Survival Analysis Card */}
            {(() => {
              const snap = (detail.case.listingSnapshot || {}) as Record<string, unknown>;
              const plaintiff = String(snap.plaintiff || "");
              const state = String(snap.state || detail.case.state || "").toUpperCase();
              const isJuniorLien =
                /^(?:high|critical)$/i.test(String(snap.seniorLienRisk || "").trim()) ||
                /(?:second\s*(?:mortgage|deed)|2nd\s*(?:mortgage|deed)|junior\s*(?:mortgage|deed|lien)|\bheloc\b|(?:home\s+)?equity\s*line|subordinate\s*(?:deed|mortgage|lien)|mechanic'?s?\s*lien|construction\s*lien)/i.test(
                  String(snap.seniorLienWarning || "")
                ) ||
                /(?:second\s*(?:mortgage|deed)|2nd\s*(?:mortgage|deed)|junior\s*(?:mortgage|deed|lien)|\bheloc\b|(?:home\s+)?equity\s*line|subordinate\s*(?:deed|mortgage|lien)|mechanic'?s?\s*lien|construction\s*lien)/i.test(
                  plaintiff
                );
              const isHoaPlaintiff =
                /(?:homeowners?\s*association|condominium\s*association|\bhoa\b|\bcoa\b|master\s*association|community\s*association|property\s*owners\s*association)/i.test(
                  plaintiff
                ) ||
                /(?:homeowners?\s*association|condominium\s*association|\bhoa\b|\bcoa\b)/i.test(
                  String(snap.seniorLienWarning || "")
                );
              const isIrsLien =
                Boolean(snap.hasIrsLien || snap.hasFederalTaxLien) ||
                detail.case.sourceRef.sourceId === "irs" ||
                /(?:internal\s*revenue|\birs\b|federal\s*tax\s*lien|26\s*u\.?s\.?c\.?\s*§?\s*7425)/i.test(
                  `${String(snap.rawNotice || "")} ${String(snap.notes || "")} ${plaintiff}`
                );
              const isSuperState = ["NV", "FL", "CO", "CT", "DC", "MD", "PA", "WA", "MA", "MN", "MO", "NJ", "OR", "RI", "TN", "VT", "WV", "AL", "AK", "HI", "IL", "NY"].includes(state);

              return (
                <section data-testid="case-title-risk-section" className="rounded-card border border-line bg-card p-5 sm:p-7">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <ShieldAlert size={19} className="text-ink" />
                      <h2 className="text-xl font-semibold">Title Risk &amp; Senior Lien Survival</h2>
                    </div>
                    {isJuniorLien && decisionState !== "pass" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setDecisionState("pass");
                          setReasonCodes((prev) => [...new Set([...prev, "title_risk_unresolved"])]);
                          if (!note) setNote("Pass: Junior lien foreclosure value trap. Senior mortgage survives sale.");
                          setMessage("Applied Title Risk Unresolved pass recommendation.");
                        }}
                        className="inline-flex items-center gap-1.5 rounded-control border border-catch/30 bg-catch-wash px-3 py-1.5 text-xs font-semibold text-catch-ink hover:bg-catch-wash/80 disabled:opacity-50"
                      >
                        <ShieldAlert size={13} />
                        Pass: Title Risk Trap
                      </button>
                    )}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-ink-2">
                    Deterministic title risk arbitration checking senior deed survival, 26 U.S.C. § 7425(d) federal tax liens, and state HOA super-priority rules.
                  </p>

                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-control border border-line bg-paper/70 p-3.5 text-xs">
                      <span className="text-label font-bold uppercase tracking-wider text-ink-3">Foreclosing Party &amp; Priority</span>
                      <p className="mt-1 font-bold text-ink truncate">
                        {plaintiff ? sourceDisplayText(plaintiff) : "Unpublished plaintiff"}
                      </p>
                      <span className={cn(
                        "mt-1.5 inline-block text-label font-bold uppercase px-2 py-0.5 rounded",
                        isJuniorLien ? "bg-catch-wash text-catch-ink border border-catch/30" :
                        isHoaPlaintiff ? "bg-catch-wash text-catch-ink border border-catch/30" :
                        "bg-paper text-ink"
                      )}>
                        {isJuniorLien ? "Junior Lien (Senior Survives)" : isHoaPlaintiff ? "HOA Assessment Lien" : "Senior Mortgage Position"}
                      </span>
                    </div>

                    <div className="rounded-control border border-line bg-paper/70 p-3.5 text-xs">
                      <span className="text-label font-bold uppercase tracking-wider text-ink-3">Federal Tax Lien (26 U.S.C. § 7425)</span>
                      <p className="mt-1 font-bold text-ink">
                        {isIrsLien ? "120-Day IRS Redemption Active" : "No Federal Tax Lien Flag"}
                      </p>
                      <span className={cn(
                        "mt-1.5 inline-block text-label font-bold uppercase px-2 py-0.5 rounded",
                        isIrsLien ? "bg-catch-wash text-catch-ink border border-catch/30" : "bg-paper text-ink-2"
                      )}>
                        {isIrsLien ? "Active Redemption Window" : "Clear of IRS Citations"}
                      </span>
                    </div>

                    <div className="rounded-control border border-line bg-paper/70 p-3.5 text-xs">
                      <span className="text-label font-bold uppercase tracking-wider text-ink-3">HOA Super-Priority Status</span>
                      <p className="mt-1 font-bold text-ink">
                        {state === "NV" ? "NV 9-Mo Super-Priority (NRS 116.3116)" : state === "FL" ? "FL Safe Harbor (Fla. Stat. § 718.116)" : isSuperState ? `${state} UCIOA Super-Priority` : `${state} Standard Subordinate`}
                      </p>
                      <span className={cn(
                        "mt-1.5 inline-block text-label font-bold uppercase px-2 py-0.5 rounded",
                        isSuperState ? "bg-yours-wash text-yours border border-yours/30" : "bg-paper text-ink-2"
                      )}>
                        {state === "NV" ? "Extinguishes Senior Mortgage" : isSuperState ? "Super-Priority Assessment" : "Subordinate to 1st Deed"}
                      </span>
                    </div>
                  </div>

                  {isJuniorLien && (
                    <div className="mt-4 rounded-control border border-catch/30 bg-catch-wash p-4 text-xs text-catch-ink">
                      <strong className="block font-bold uppercase tracking-wide text-catch-ink">
                        VALUE TRAP WARNING: Junior Lien Foreclosure
                      </strong>
                      <p className="mt-1 text-xs leading-relaxed text-catch-ink">
                        The foreclosing plaintiff holds a subordinate instrument (2nd mortgage, HELOC, or mechanic&apos;s construction lien). A steep price drop or low opening bid does not reflect total encumbrances. The winning bidder takes title subject to the underlying senior 1st mortgage in full.
                      </p>
                    </div>
                  )}
                </section>
              );
            })()}

            {(() => {
              const docket = detail.case.listingSnapshot
                ? evaluateAdversarialDocket(detail.case.listingSnapshot as any)
                : null;
              if (!docket) return null;
              return (
                <section data-testid="case-adversarial-docket" className="rounded-card border border-line bg-card p-5 sm:p-7">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Scale size={19} className="text-ink" />
                      <h2 className="text-xl font-semibold">Adversarial Trial Docket: Prosecution vs. Defense</h2>
                    </div>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setDecisionState(docket.recommendedDecision);
                        setReasonCodes((prev) => [...new Set([...prev, ...docket.recommendedReasonCodes])]);
                        if (!note) {
                          setNote(docket.docketSummaryNote);
                        } else if (!note.includes(docket.headline)) {
                          setNote(`${docket.docketSummaryNote}\n\n${note}`);
                        }
                        setMessage(`Applied trial recommendation: ${docket.recommendedDecision.toUpperCase()} with ${docket.recommendedReasonCodes.length} reason code(s). Review reasons and click Save Decision to commit.`);
                      }}
                      className="inline-flex items-center gap-1.5 rounded-control border border-line-strong bg-paper px-3 py-1.5 text-xs font-semibold text-ink hover:bg-paper disabled:opacity-50"
                    >
                      <Gavel size={13} />
                      Apply Trial Recommendation
                    </button>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-ink-2">
                    Adversarial audit pitting 7 statutory deal-killers against recording acts, cadastral verification, and walk-away math.
                  </p>

                  <div className={cn("mt-4 rounded-control border p-4 text-xs", docket.badgeClass)}>
                    <div className="flex items-start gap-2.5">
                      {docket.verdict === "fatal" ? (
                        <ShieldAlert size={18} className="shrink-0 text-catch-ink" />
                      ) : docket.verdict === "conditional" ? (
                        <AlertTriangle size={18} className="shrink-0 text-catch-ink" />
                      ) : (
                        <ShieldCheck size={18} className="shrink-0 text-ink-2" />
                      )}
                      <div>
                        <span className="font-extrabold uppercase text-xs tracking-wide">{docket.headline}</span>
                        <p className="mt-1 leading-relaxed font-medium">{docket.verdictDescription}</p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-3 gap-3 text-center text-xs">
                    <div className="rounded-control border border-catch/30 bg-catch-wash/70 p-3">
                      <span className="text-label font-bold uppercase tracking-wider text-catch-ink">Fatal Deal-Killers</span>
                      <p className="mt-0.5 text-lg font-black text-ink">{docket.fatalCount}</p>
                    </div>
                    <div className="rounded-control border border-catch/30 bg-catch-wash/40 p-3">
                      <span className="text-label font-bold uppercase tracking-wider text-catch-ink">Caution Points</span>
                      <p className="mt-0.5 text-lg font-black text-ink">{docket.cautionCount}</p>
                    </div>
                    <div className="rounded-control border border-line bg-paper p-3">
                      <span className="text-label font-bold uppercase tracking-wider text-ink">Defenses Verified</span>
                      <p className="mt-0.5 text-lg font-black text-ink">{docket.defenseCount} of {docket.defensePoints.length}</p>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-4 lg:grid-cols-2 text-xs">
                    <div className="space-y-2 rounded-control border border-line bg-paper/50 p-4">
                      <div className="flex items-center justify-between border-b border-line pb-2">
                        <div className="flex items-center gap-1.5 font-bold text-ink">
                          <Gavel size={14} className="text-catch-ink" />
                          <span>Prosecution Attack Vectors</span>
                        </div>
                        <span className="text-label font-semibold text-ink-3">7 checkpoints</span>
                      </div>
                      <ul className="space-y-2 pt-1">
                        {docket.prosecutionPoints.map((item) => (
                          <li key={item.id} className="rounded-control bg-card p-2.5 border border-line shadow-2xs">
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-semibold text-ink">{item.title}</span>
                              <span className={cn(
                                "text-label font-bold uppercase px-1.5 py-0.5 rounded",
                                item.status === "disqualified" ? "bg-catch/15 text-catch-ink" :
                                item.status === "caution" ? "bg-catch-wash text-catch-ink" :
                                "bg-paper text-ink-2"
                              )}>
                                {item.status === "disqualified" ? "Disqualified" : item.status === "caution" ? "Caution" : "Pre-Auction"}
                              </span>
                            </div>
                            <p className="mt-1 text-xs leading-relaxed text-ink-2">{item.finding}</p>
                            <span className="mt-1 block text-label text-ink-3">Statute: {item.statute}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="space-y-2 rounded-control border border-line bg-paper/50 p-4">
                      <div className="flex items-center justify-between border-b border-line pb-2">
                        <div className="flex items-center gap-1.5 font-bold text-ink">
                          <ShieldCheck size={14} className="text-ink" />
                          <span>Defense Value Shields</span>
                        </div>
                        <span className="text-label font-semibold text-ink-3">4 defenses</span>
                      </div>
                      <ul className="space-y-2 pt-1">
                        {docket.defensePoints.map((item) => (
                          <li key={item.id} className="rounded-control bg-card p-2.5 border border-line shadow-2xs">
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-semibold text-ink">{item.title}</span>
                              <span className={cn(
                                "text-label font-bold uppercase px-1.5 py-0.5 rounded",
                                item.status === "verified" ? "bg-paper text-ink" : "bg-paper text-ink-2"
                              )}>
                                {item.status === "verified" ? "Verified" : "Pending"}
                              </span>
                            </div>
                            <p className="mt-1 text-xs leading-relaxed text-ink-2">{item.finding}</p>
                            <span className="mt-1 block text-label text-ink-3">Authority: {item.statute}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </section>
              );
            })()}
            {(() => {
              const localScenario = detail.case.listingId ? readUnderwriteScenario(detail.case.listingId) : null;
              const serverScenario = detail.case.underwriteScenario || null;
              const effectiveScenario = localScenario || serverScenario;
              const hasDiff = localScenario && serverScenario && JSON.stringify(localScenario) !== JSON.stringify(serverScenario);
              return (
                <section className="rounded-card border border-line bg-card p-5 sm:p-7">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <Calculator size={19} className="text-ink" />
                      <h2 className="text-xl font-semibold">Underwriting scenario &amp; acquisition model</h2>
                    </div>
                    {localScenario && (hasDiff || !serverScenario) && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void syncLocalScenario()}
                        className="inline-flex items-center gap-1.5 rounded-control border border-line-strong bg-paper px-3 py-1.5 text-xs font-semibold text-ink hover:bg-paper disabled:opacity-50"
                      >
                        <Save size={13} />
                        Sync local model to case
                      </button>
                    )}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-ink-2">
                    Investor assumptions modeled in the bidding terminal. These inputs govern Max Allowable Offer and statutory cash-to-close calculations.
                  </p>
                  {effectiveScenario ? (
                    <div className="mt-5 space-y-4">
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <div className="rounded-control bg-paper p-3.5 border border-line">
                          <span className="text-label font-bold uppercase tracking-wider text-ink-2">Valuation</span>
                          <p className="mt-1 text-sm font-bold text-ink">
                            {effectiveScenario.customValuation ? `$${Number(effectiveScenario.customValuation).toLocaleString()}` : "Market benchmark"}
                          </p>
                        </div>
                        <div className="rounded-control bg-paper p-3.5 border border-line">
                          <span className="text-label font-bold uppercase tracking-wider text-ink-2">Assumed Opening Bid</span>
                          <p className="mt-1 text-sm font-bold text-ink">
                            {effectiveScenario.customOpeningBid ? `$${Number(effectiveScenario.customOpeningBid).toLocaleString()}` : (typeof detail.case.openingBid === "number" ? `$${detail.case.openingBid.toLocaleString()}` : "Unpublished")}
                          </p>
                        </div>
                        <div className="rounded-control bg-paper p-3.5 border border-line">
                          <span className="text-label font-bold uppercase tracking-wider text-ink-2">Max Allowable Offer</span>
                          <p className="mt-1 text-sm font-bold text-ink">
                            {typeof effectiveScenario.maxAllowableOffer === "number" ? `$${effectiveScenario.maxAllowableOffer.toLocaleString()}` : "Requires valuation"}
                          </p>
                        </div>
                        <div className="rounded-control bg-paper p-3.5 border border-line">
                          <span className="text-label font-bold uppercase tracking-wider text-ink-2">Rehab &amp; Margin</span>
                          <p className="mt-1 text-sm font-bold text-ink">
                            ${effectiveScenario.rehabBudget.toLocaleString()} · {effectiveScenario.targetMargin}%
                          </p>
                        </div>
                      </div>
                      <div className="rounded-control bg-paper p-4 text-xs text-ink-2 space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-ink font-semibold">
                          <span>Holding period assumption: {effectiveScenario.holdingMonths || 6} months</span>
                          <Link href={`/listings/${encodeURIComponent(detail.case.listingId)}#due-diligence-binder`} className="text-ink underline hover:text-ink-2 text-xs font-semibold">
                            Tune in terminal →
                          </Link>
                        </div>
                        <p className="text-xs text-ink-3">
                          Transfer tax: ${effectiveScenario.transferTax || "0"} · Delinquent taxes: ${effectiveScenario.delinquentTaxes || "0"} · Settlement: ${effectiveScenario.settlementCosts || "0"} · Buyer premium: ${effectiveScenario.buyersPremium || "0"} · Sheriff poundage: ${effectiveScenario.sheriffPoundage || "0"}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-control bg-paper p-4 text-xs text-ink-2 border border-line">
                      <p>No customized underwriting scenario has been attached to this case yet.</p>
                      <p className="mt-1">
                        <Link href={`/listings/${encodeURIComponent(detail.case.listingId)}#due-diligence-binder`} className="text-ink underline font-semibold">
                          Open listing bidding simulator
                        </Link>{" "}
                        to model target price, rehab budget, and statutory fees.
                      </p>
                    </div>
                  )}
                </section>
              );
            })()}
            <section className="rounded-card border border-line bg-card p-5 sm:p-7"><div className="flex items-center gap-2"><GitCompareArrows size={19} className="text-ink" /><h2 className="text-xl font-semibold">Evidence comparison</h2></div><p className="mt-2 text-xs leading-5 text-ink-2">Publisher claims and matched official-record claims remain separate. A blank side means the evidence is still unknown.</p><div className="mt-5 grid gap-4 md:grid-cols-2"><ClaimColumn title="Publisher record" claims={detail.dossier.claimGroups?.publisher || []} empty="No publisher claims were retained in this dossier snapshot." /><ClaimColumn title="Official records" claims={detail.dossier.claimGroups?.official || []} empty="No parcel-level official record has been matched." /></div>{(detail.dossier.signals || []).length > 0 && <div className="mt-5 border-t border-line pt-5"><h3 className="text-sm font-semibold">Conflicts and cautions</h3><div className="mt-3 space-y-2">{detail.dossier.signals?.map((signal, index) => <div key={index} className="rounded-control bg-catch-wash p-4 text-xs leading-5 text-catch-ink"><p className="font-semibold">{sourceDisplayText(signal.title || signal.type || "Evidence signal")}</p><p className="mt-1">{sourceDisplayText(signal.reason || "Review the underlying evidence.")}</p></div>)}</div></div>}</section>

            <section className="rounded-card border border-line bg-card p-5 sm:p-7"><div className="flex items-center gap-2"><ShieldQuestion size={19} className="text-ink" /><h2 className="text-xl font-semibold">What to investigate next</h2></div><div className="mt-4 space-y-3">{(detail.dossier.gaps || []).map((gap, index) => <article key={gap.key || index} className="rounded-control bg-paper p-4"><h3 className="text-sm font-semibold">{sourceDisplayText(gap.title || gap.key || "Open question")}</h3><p className="mt-2 text-xs leading-5 text-ink-2">{sourceDisplayText(gap.reason || "Supporting evidence has not been linked.")}</p>{gap.nextAction && <p className="mt-2 text-xs font-semibold text-ink">Next: {sourceDisplayText(gap.nextAction)}</p>}</article>)}{!(detail.dossier.gaps || []).length && <p className="text-sm text-ink-2">No open questions were recorded in this snapshot. Recheck source freshness before acting.</p>}<button type="button" disabled={busy} onClick={() => void recheckSource()} className="inline-flex items-center gap-2 rounded-control border border-line-strong px-3 py-2 text-xs font-semibold disabled:opacity-50"><RotateCcw size={14} />Check latest saved observation</button></div></section>

            <section className="rounded-card border border-line bg-card p-5 sm:p-7"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><FileCheck2 size={19} className="text-ink" /><h2 className="text-xl font-semibold">Reviewed evidence</h2></div><button type="button" disabled={busy} onClick={() => void loadEvidence()} className="rounded-control border border-line px-3 py-2 text-xs font-semibold">Load review queue</button></div><div className="mt-4 space-y-3">{detail.case.evidenceLinks.map((link) => <article key={link.intakeId} className="rounded-control bg-paper p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold">{sourceDisplayText(link.relationship.replaceAll("_", " "))}</p><a href={link.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 break-all text-xs text-ink underline hover:text-ink-2">Open exact evidence <ExternalLink size={12} /></a><p className="mt-2 text-label text-ink-2">SHA-256 {link.contentSha256}</p></div><button type="button" aria-label="Unlink evidence" disabled={busy} onClick={() => void unlinkEvidence(link.intakeId)} className="rounded-control p-2 hover:bg-paper"><Trash2 size={15} /></button></div></article>)}{!detail.case.evidenceLinks.length && <p className="text-sm text-ink-2">No reviewed attachments are linked.</p>}</div>{intake.length > 0 && <div className="mt-5 grid gap-2 border-t border-line pt-5 sm:grid-cols-[1fr_180px_auto]"><select aria-label="Reviewed evidence packet" value={selectedEvidence} onChange={(event) => setSelectedEvidence(event.target.value)} className="rounded-control border border-line bg-card px-3 py-2 text-xs">{intake.map((item) => <option key={item.id} value={item.id}>{sourceDisplayText(item.sourceId)} · {item.id}</option>)}</select><select aria-label="Evidence relationship" value={relationship} onChange={(event) => setRelationship(event.target.value)} className="rounded-control border border-line bg-card px-3 py-2 text-xs">{relationships.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select><button type="button" disabled={busy || !selectedEvidence} onClick={() => void linkEvidence()} className="inline-flex items-center justify-center gap-1 rounded-control bg-ink px-3 py-2 text-xs font-semibold text-white"><Link2 size={13} />Link</button></div>}<p className="mt-4 text-xs leading-5 text-ink-2">Attachment review confirms the file and source reference were reviewed. It does not make every extracted statement a verified property fact.</p></section>

            <section className="rounded-card border border-line bg-card p-5 sm:p-7"><div className="flex items-center gap-2"><History size={19} className="text-ink" /><h2 className="text-xl font-semibold">Observation and decision timeline</h2></div><ol className="mt-5 space-y-4">{detail.case.timeline.map((entry, index) => <li key={entry.id || index} className="relative border-l-2 border-line pl-5"><span className="absolute -left-[6px] top-1 h-2.5 w-2.5 rounded-full bg-ink" /><p className="text-xs font-semibold">{sourceDisplayText(entry.type.replaceAll("_", " "))}</p><p className="mt-1 text-xs text-ink-2">{new Date(entry.at).toLocaleString()} · Revision {entry.revision || "—"}</p></li>)}</ol></section>
          </div>

          <aside className="rounded-card border border-line bg-card p-5 xl:sticky xl:top-24"><h2 className="text-xl font-semibold">Record your decision</h2><p className="mt-2 text-xs leading-5 text-ink-2">The decision and its reasons are versioned with the same evidence snapshot used by exports.</p><div className="mt-5 grid grid-cols-3 gap-2">{(["inbox", "pursue", "pass"] as const).map((value) => <button key={value} type="button" aria-pressed={decisionState === value} onClick={() => setDecisionState(value)} className={`rounded-control px-3 py-2.5 text-xs font-semibold capitalize ${decisionState === value ? "bg-ink text-white" : "border border-line"}`}>{value}</button>)}</div>
            {(() => {
              const docket = detail.case.listingSnapshot
                ? evaluateAdversarialDocket(detail.case.listingSnapshot as any)
                : null;
              if (docket?.verdict !== "fatal") return null;
              return (
                <div data-testid="prosecution-fatal-aside-alert" className="mt-4 rounded-control border border-catch/40 bg-catch-wash p-3.5 text-xs text-catch-ink">
                  <div className="flex items-start gap-2">
                    <ShieldAlert size={16} className="mt-0.5 shrink-0 text-catch-ink" />
                    <div className="space-y-1">
                      <strong className="block font-bold">Prosecution Verdict: FATAL DISQUALIFIER</strong>
                      <p className="text-xs leading-relaxed text-catch-ink">
                        Senior lien or bankruptcy stay detected. Recommended decision: <strong>PASS</strong>.
                      </p>
                      {decisionState !== "pass" && (
                        <button
                          type="button"
                          onClick={() => {
                            setDecisionState("pass");
                            setReasonCodes((prev) => [...new Set([...prev, ...docket.recommendedReasonCodes])]);
                            if (!note) setNote(docket.docketSummaryNote);
                          }}
                          className="mt-1.5 inline-flex items-center gap-1 rounded bg-catch-ink px-2.5 py-1 text-xs font-semibold text-white hover:bg-catch"
                        >
                          Apply Injunctive Pass
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            {(detail.case.latestTrigger?.titleRiskAlert === "JUNIOR_LIEN_SURVIVING_MORTGAGE" || detail.case.latestTrigger?.alerts?.includes("JUNIOR_LIEN_SURVIVING_MORTGAGE")) && (
              <div data-testid="junior-lien-aside-warning" className="mt-4 rounded-control border border-catch/40 bg-catch-wash/70 p-3.5 text-xs text-catch-ink">
                <div className="flex items-start gap-2">
                  <ShieldAlert size={16} className="mt-0.5 shrink-0 text-catch-ink" />
                  <div className="space-y-1">
                    <strong className="block font-bold uppercase tracking-wider">VALUE TRAP DETECTED</strong>
                    <p className="text-xs leading-relaxed">
                      Junior lien foreclosure (2nd mortgage / HELOC / mechanic&apos;s lien). Senior 1st mortgage survives sale in full!
                    </p>
                    {decisionState !== "pass" && (
                      <button
                        type="button"
                        onClick={() => {
                          setDecisionState("pass");
                          setReasonCodes((prev) => [...new Set([...prev, "title_risk_unresolved"])]);
                          if (!note) setNote("Pass: Junior lien foreclosure value trap. Senior mortgage survives sale.");
                        }}
                        className="mt-1.5 inline-flex items-center gap-1 rounded bg-catch-ink px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90"
                      >
                        Pass: Value Trap
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {decisionState !== "inbox" && <fieldset className="mt-5"><legend className="text-xs font-semibold">Reasons {decisionState === "pass" ? "(choose at least one)" : ""}</legend><div className="mt-3 space-y-2">{reasonChoices.map(([value, title]) => <label key={value} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={reasonCodes.includes(value)} onChange={(event) => setReasonCodes(event.target.checked ? [...reasonCodes, value] : reasonCodes.filter((item) => item !== value))} />{title}</label>)}</div></fieldset>}
            <label className="mt-5 block text-xs font-semibold">Decision note<textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} rows={4} className="mt-2 w-full rounded-control border border-line p-3 text-sm font-normal" placeholder="What matters, what is unresolved, and what you will verify." /></label>
            {decisionState === "pass" && <div className="mt-5 border-t border-line pt-5"><div className="flex items-center gap-2"><RotateCcw size={16} className="text-ink" /><h3 className="text-sm font-semibold">Bring it back when…</h3></div><select aria-label="Reconsideration matching" value={mode} onChange={(event) => setMode(event.target.value as "any" | "all")} className="mt-3 w-full rounded-control border border-line bg-card px-3 py-2 text-xs"><option value="any">Any condition matches</option><option value="all">Every condition matches</option></select><div className="mt-3 space-y-3">{conditions.map((condition, index) => <ConditionEditor key={index} condition={condition} onChange={(next) => setConditions(conditions.map((item, itemIndex) => itemIndex === index ? next : item))} onRemove={conditions.length > 1 ? () => setConditions(conditions.filter((_, itemIndex) => itemIndex !== index)) : undefined} />)}</div><button type="button" disabled={conditions.length >= 10} onClick={() => setConditions([...conditions, { field: "saleDate", operator: "changed" }])} className="mt-3 text-xs font-semibold text-ink underline hover:text-ink-2 disabled:opacity-50">Add return condition</button></div>}
            <button type="button" disabled={busy || (decisionState === "pass" && reasonCodes.length === 0)} onClick={() => void saveDecision()} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-control bg-ink px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}Save decision</button>
            <div className="mt-5 rounded-control bg-paper p-4 text-xs leading-5 text-ink-2"><p className="flex items-center gap-2 font-semibold text-ink"><Clock3 size={14} />Reproducible revision</p><p className="mt-1">Packets generated now use case revision {detail.case.revision}. Changed inputs create a new revision; earlier timeline entries remain.</p></div>
          </aside>
        </div>
      </>}
    </PrivateWorkspaceGate>
  </div>;
}

function ClaimColumn({ title, claims, empty }: { title: string; claims: Claim[]; empty: string }) {
  return <div className="rounded-control border border-line p-4"><h3 className="text-sm font-semibold">{title}</h3><dl className="mt-3 space-y-3">{claims.map((claim, index) => <div key={`${claim.key || claim.title}-${index}`}><dt className="text-label font-bold uppercase tracking-wider text-ink-2">{claimName(claim)}</dt><dd className="mt-1 break-words text-sm font-semibold">{show(claim.value)}</dd>{claim.sourceUrl && <a href={claim.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-label text-ink underline hover:text-ink-2">Source <ExternalLink size={10} /></a>}</div>)}{!claims.length && <p className="text-xs leading-5 text-ink-2">{empty}</p>}</dl></div>;
}

function ConditionEditor({ condition, onChange, onRemove }: { condition: ReconsiderationCondition; onChange: (value: ReconsiderationCondition) => void; onRemove?: () => void }) {
  const numeric = condition.field === "openingBid" || condition.field === "sqft";
  const evidence = condition.field === "requiredEvidence";
  const titleRisk = condition.field === "titleRisk";
  const operatorOptions = evidence
    ? [["available", "becomes available"]]
    : titleRisk
    ? [
        ["junior_lien_surviving_mortgage", "Junior lien surviving mortgage trap"],
        ["irs_redemption_active", "Active IRS 120-day redemption window"],
        ["hoa_super_priority", "HOA super-priority assessment risk (UCIOA/NV/FL)"],
        ["changed", "Title risk status changes"],
      ]
    : condition.field === "openingBid"
    ? [
        ["changed", "changes"],
        ["lte", "is at most ($)"],
        ["gte", "is at least ($)"],
        ["dropped_by_pct", "drops by at least (%)"],
        ["bid_to_assessed_lte", "is at most % of assessed"],
      ]
    : condition.field === "saleDate"
    ? [["changed", "changes"], ["within_days", "is within N days"]]
    : numeric
    ? [["changed", "changes"], ["lte", "is at most"], ["gte", "is at least"]]
    : [["changed", "changes"]];

  return <div className="rounded-control bg-paper p-3"><div className="flex gap-2"><select aria-label="Reconsideration field" value={condition.field} onChange={(event) => { const field = event.target.value as ReconsiderationCondition["field"]; onChange(field === "requiredEvidence" ? { field, operator: "available", value: "any" } : field === "titleRisk" ? { field, operator: "junior_lien_surviving_mortgage" } : { field, operator: "changed" }); }} className="min-w-0 flex-1 rounded-control border border-line bg-card px-2 py-2 text-xs"><option value="openingBid">Opening amount</option><option value="saleDate">Sale date</option><option value="status">Published status</option><option value="sqft">Building area</option><option value="requiredEvidence">Required evidence</option><option value="titleRisk">Title risk &amp; senior lien</option></select>{onRemove && <button type="button" aria-label="Remove condition" onClick={onRemove} className="rounded-control px-2 hover:bg-paper"><Trash2 size={14} /></button>}</div><select aria-label="Reconsideration operator" value={condition.operator} onChange={(event) => { const operator = event.target.value as ReconsiderationCondition["operator"]; const needsNumeric = operator === "lte" || operator === "gte" || operator === "dropped_by_pct" || operator === "bid_to_assessed_lte" || operator === "within_days"; onChange({ field: condition.field, operator, ...(needsNumeric ? { value: typeof condition.value === "number" && condition.value > 0 ? condition.value : operator === "dropped_by_pct" ? 10 : operator === "bid_to_assessed_lte" ? 65 : operator === "within_days" ? 14 : 0 } : operator === "available" ? { value: typeof condition.value === "string" ? condition.value : "any" } : {}) }); }} className="mt-2 w-full rounded-control border border-line bg-card px-2 py-2 text-xs">{operatorOptions.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select>{(condition.operator === "lte" || condition.operator === "gte" || condition.operator === "dropped_by_pct" || condition.operator === "bid_to_assessed_lte" || condition.operator === "within_days") && <input aria-label="Reconsideration threshold" type="number" min={condition.operator === "within_days" || condition.operator === "dropped_by_pct" || condition.operator === "bid_to_assessed_lte" ? 1 : 0} max={condition.operator === "dropped_by_pct" || condition.operator === "bid_to_assessed_lte" ? 100 : condition.operator === "within_days" ? 365 : undefined} value={typeof condition.value === "number" ? condition.value : 0} onChange={(event) => onChange({ ...condition, value: Number(event.target.value) })} className="mt-2 w-full rounded-control border border-line bg-card px-2 py-2 text-xs" />}{condition.operator === "available" && <select aria-label="Required evidence type" value={typeof condition.value === "string" ? condition.value : "any"} onChange={(event) => onChange({ ...condition, value: event.target.value })} className="mt-2 w-full rounded-control border border-line bg-card px-2 py-2 text-xs"><option value="any">Any reviewed evidence</option><option value="sale_terms">Sale terms</option><option value="title_research">Title research</option><option value="occupancy_research">Occupancy research</option><option value="valuation_research">Valuation research</option></select>}</div>;
}
