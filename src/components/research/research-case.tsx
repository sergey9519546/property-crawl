"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, Calculator, Check, Clock3, Download, ExternalLink, FileCheck2, Gavel, GitCompareArrows, History, Link2, Loader2, RotateCcw, Save, Scale, ShieldAlert, ShieldCheck, ShieldQuestion, Trash2 } from "lucide-react";
import { readUnderwriteScenario } from "@/lib/underwrite-scenario";
import { PrivateWorkspaceGate, useWorkspaceSession } from "@/components/workspace/workspace-shell";
import type { Claim, ReconsiderationCondition, ResearchCaseDetail, ResearchDossier } from "@/lib/workspace-types";
import { sourceDisplayText } from "@/lib/source-display";
import { localizedListingCatch } from "@/lib/i18n/domain";
import { useLocale } from "@/components/i18n/locale-provider";
import type { Locale } from "@/lib/i18n/config";
import { formatLocaleDate, formatLocaleNumber, formatUsd, interpolate } from "@/lib/i18n/translator";
import { bandForScore } from "@/lib/score-bands";
import { evaluateAdversarialDocket } from "@/lib/adversarial-docket";
import { cn } from "@/lib/utils";

type DetailResponse = { case: ResearchCaseDetail; dossier: ResearchDossier };
type IntakeItem = { id: string; sourceId: string; sourceUrl: string; capturedAt: string; review?: { decision?: string }; status?: string };

const relationships = ["sale_terms", "title_research", "occupancy_research", "valuation_research", "supports_identity", "other"] as const;

function show(value: unknown, locale: Locale, unknownLabel: string) {
  if (value === null || value === undefined || value === "") return unknownLabel;
  if (typeof value === "number") return locale === "en" ? value.toLocaleString() : formatLocaleNumber(locale, value);
  if (typeof value === "string") return sourceDisplayText(value);
  return sourceDisplayText(JSON.stringify(value));
}

function claimName(claim: Claim, fallback: string) { return sourceDisplayText(claim.title || claim.key || fallback); }

export function ResearchCase({ caseId }: { caseId: string }) {
  const { locale, messages } = useLocale();
  const t = messages.researchB2;
  const d = messages.designB2;
  const fmtMoney = (n: number) => (locale === "en" ? `$${Math.round(n).toLocaleString()}` : formatUsd(locale, n));
  const fmtMoneyStr = (raw: string | number | null | undefined) => {
    const n = Number(raw || 0);
    return Number.isFinite(n) ? fmtMoney(n) : "$0";
  };
  const fmtDateTime = (value: string) =>
    locale === "en"
      ? new Date(value).toLocaleString()
      : formatLocaleDate(locale, value, { dateStyle: "medium", timeStyle: "short" });

  const reasonChoices = [
    ["price_above_target", t.rcReasonPriceAbove],
    ["missing_sale_terms", t.rcReasonMissingTerms],
    ["title_risk_unresolved", t.rcReasonTitleRisk],
    ["insufficient_margin", t.rcReasonLowMargin],
    ["property_condition", t.rcReasonCondition],
    ["timing_or_funds", t.rcReasonTimingFunds],
  ] as const;

  const relationshipLabels: Record<string, string> = {
    sale_terms: t.rcRelSaleTerms,
    title_research: t.rcRelTitleResearch,
    occupancy_research: t.rcRelOccupancyResearch,
    valuation_research: t.rcRelValuationResearch,
    supports_identity: t.rcRelSupportsIdentity,
    other: t.rcRelOther,
  };

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
      if (!response.ok) throw new Error(result.error || t.rcErrLoadCase);
      setDetail(result); setError("");
      setDecisionState(result.case.state);
      setReasonCodes(result.case.decision?.reasonCodes || []);
      setNote(result.case.decision?.note || "");
      if (result.case.reconsideration?.conditions?.length) { setMode(result.case.reconsideration.mode); setConditions(result.case.reconsideration.conditions); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : t.rcErrLoadCase); }
    finally { setLoading(false); }
  }, [caseId, session.authenticated, t.rcErrLoadCase]);

  React.useEffect(() => { void load(); }, [load]);

  async function mutate(path: string, method: string, body: unknown) {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(path, { method, credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || t.rcErrUpdateCase);
      await load(); return result;
    } catch (caught) { setError(caught instanceof Error ? caught.message : t.rcErrUpdateCase); return null; }
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
    if (result) setMessage(result.sourceCheck?.updated === true ? t.rcMsgRecheckFound : t.rcMsgRecheckNone);
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
    if (result) setMessage(t.rcMsgSyncedLocal);
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
    if (result) setMessage(decisionState === "pass" ? t.rcMsgPassSaved : t.rcMsgDecisionSaved);
  }

  async function loadEvidence() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/source-network/intake?includeContent=false", { cache: "no-store", credentials: "same-origin" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || t.rcErrLoadEvidence);
      const approved = (result.items || []).filter((item: IntakeItem) => item.review?.decision === "approved");
      setIntake(approved); if (approved[0]) setSelectedEvidence(approved[0].id);
      setMessage(
        approved.length
          ? interpolate(approved.length === 1 ? t.rcMsgEvidenceAvailSingle : t.rcMsgEvidenceAvailPlural, { count: approved.length })
          : t.rcMsgEvidenceNone,
      );
    } catch (caught) { setError(caught instanceof Error ? caught.message : t.rcErrLoadEvidence); }
    finally { setBusy(false); }
  }

  async function linkEvidence() {
    if (!detail || !selectedEvidence) return;
    const result = await mutate(`/api/workspace/cases/${encodeURIComponent(caseId)}/evidence`, "POST", { expectedRevision: detail.case.revision, intakeId: selectedEvidence, relationship });
    if (result) setMessage(t.rcMsgEvidenceLinked);
  }

  async function unlinkEvidence(intakeId: string) {
    if (!detail) return;
    const result = await mutate(`/api/workspace/cases/${encodeURIComponent(caseId)}/evidence/${encodeURIComponent(intakeId)}`, "DELETE", { expectedRevision: detail.case.revision });
    if (result) setMessage(t.rcMsgEvidenceUnlinked);
  }

  async function downloadPacket(format: "json" | "md") {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/workspace/cases/${encodeURIComponent(caseId)}/packet?format=${format}`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) { const result = await response.json(); throw new Error(result.error || t.rcErrPacketGen); }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `property-research-${caseId}-r${detail?.case.revision || "current"}.${format === "md" ? "md" : "json"}`; anchor.click();
      URL.revokeObjectURL(url); setMessage(t.rcMsgPacketGen);
    } catch (caught) { setError(caught instanceof Error ? caught.message : t.rcErrPacketGen); }
    finally { setBusy(false); }
  }

  const stateLabels: Record<"inbox" | "pursue" | "pass", string> = {
    inbox: t.rcStateInbox,
    pursue: t.rcStatePursue,
    pass: t.rcStatePass,
  };

  return <div className="mx-auto max-w-[1380px] px-5 py-8 sm:px-8">
    <Link href={returnTo} className="inline-flex items-center gap-2 text-xs font-semibold text-ink-2 hover:text-ink"><ArrowLeft size={14} />{t.rcBackResearch}</Link>
    <PrivateWorkspaceGate title={t.rcGateTitle} headingLevel={1}>
      {loading && !detail
        ? <>
            <h1 className="mt-6 text-2xl font-semibold text-ink">{t.rcLoadingTitle}</h1>
            <p className="mt-3 flex items-center gap-2 rounded-card bg-card p-7 text-sm"><Loader2 size={17} className="animate-spin" />{t.rcLoadingBody}</p>
          </>
        : error && !detail
          ? <>
              <h1 className="mt-6 text-2xl font-semibold text-ink">{t.rcErrorTitle}</h1>
              <p role="alert" className="mt-3 rounded-card bg-catch-wash p-6 text-sm text-catch-ink">{error}</p>
            </>
          : detail && <>
        <header className="mt-6 rounded-card bg-ink p-6 text-white sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-5"><div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-card/10 px-3 py-1 text-label font-bold uppercase tracking-wider">{stateLabels[detail.case.state as "inbox" | "pursue" | "pass"] ?? detail.case.state}</span>{detail.case.reconsiderationRequired && <span className="flex items-center gap-1 rounded-full bg-signature px-3 py-1 text-label font-bold uppercase tracking-wider text-ink"><RotateCcw size={12} />{t.rcSecondLookBadge}</span>}</div><h1 className="mt-4 text-3xl font-semibold sm:text-5xl">{sourceDisplayText(detail.case.address || detail.case.listingId)}</h1><p className="mt-3 text-xs text-paper/75">{sourceDisplayText(detail.case.sourceRef.sourceId)} · {sourceDisplayText(detail.case.sourceRef.recordId)} · {interpolate(t.rcCaseRevisionLine, { revision: detail.case.revision })}</p></div><div className="flex flex-wrap gap-2"><Link href={`/research/${encodeURIComponent(caseId)}/export`} className="inline-flex items-center gap-2 rounded-control border border-white/25 px-3 py-2 text-xs font-semibold">{t.rcDecisionDossierBtn}</Link><button type="button" aria-label={t.rcDownloadJsonAria} disabled={busy} onClick={() => void downloadPacket("json")} className="inline-flex items-center gap-2 rounded-control bg-card px-3 py-2 text-xs font-semibold text-ink"><Download size={14} />JSON</button><button type="button" aria-label={t.rcDownloadMdAria} disabled={busy} onClick={() => void downloadPacket("md")} className="inline-flex items-center gap-2 rounded-control border border-white/25 px-3 py-2 text-xs font-semibold"><Download size={14} />{t.rcPrintReportBtn}</button></div></div>
          {detail.case.reconsiderationRequired && (
            <div className="mt-5 rounded-control bg-ink-2 p-4 text-sm leading-6 text-paper">
              <p>{t.rcReconsiderLead}</p>
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
                        {t.rcCriticalTitleAlert}
                      </strong>
                      <p className="mt-1 leading-relaxed text-paper/90">
                        {t.rcCriticalTitleBody}
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
                        {t.rcIrsFlagTitle}
                      </strong>
                      <p className="mt-1 leading-relaxed text-paper/90">
                        {t.rcIrsFlagBody}
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
                        {t.rcHoaFlagTitle}
                      </strong>
                      <p className="mt-1 leading-relaxed text-paper/90">
                        {t.rcHoaFlagBody}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
          {(() => {
            const snap = detail.case.listingSnapshot as Parameters<typeof localizedListingCatch>[0];
            const band = bandForScore(snap.dealScore);
            const bandLabel = band
              ? (band.key === "elite" ? d.bandEliteLabel : band.key === "strong" ? d.bandStrongLabel : band.key === "fair" ? d.bandFairLabel : d.bandThinLabel)
              : "";
            const catchSummary = localizedListingCatch(snap, [], locale);
            return (
              <section data-testid="case-catch" className="mt-5 rounded-control bg-card/5 p-4 text-sm leading-6 text-paper">
                <p className="font-semibold">
                  {band ? interpolate(t.rcDealScoreBand, { score: Math.round(Number(snap.dealScore)), label: bandLabel }) : t.rcDealScoreUnavail} · {catchSummary.flags.length ? interpolate(catchSummary.flags.length === 1 ? t.rcCatchFlagSingle : t.rcCatchFlagPlural, { count: catchSummary.flags.length }) : t.rcCatchNoFlags}
                </p>
                <p className="mt-1 text-xs text-paper/80">{sourceDisplayText([...catchSummary.notes, ...catchSummary.flags].join(" "))}</p>
              </section>
            );
          })()}
        </header>
        {error && <p role="alert" className="mt-4 rounded-control bg-catch-wash p-4 text-sm text-catch-ink">{error}</p>}{message && <p role="status" className="mt-4 flex items-center gap-2 rounded-control border border-go/30 bg-go-wash p-4 text-sm text-ink"><Check size={16} />{message}</p>}

        <div className="mt-6 grid items-start gap-6 xl:grid-cols-[1fr_390px]">
          <div className="space-y-6">
            {/* Title Risk & Senior Lien Survival Analysis Card */}
            {(() => {
              const snap = (detail.case.listingSnapshot || {}) as Record<string, unknown>;
              const plaintiff = String(snap.plaintiff || "");
              const state = String(snap.state || "").toUpperCase();
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
                      <h2 className="text-xl font-semibold">{t.rcTitleRiskHeading}</h2>
                    </div>
                    {isJuniorLien && decisionState !== "pass" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setDecisionState("pass");
                          setReasonCodes((prev) => [...new Set([...prev, "title_risk_unresolved"])]);
                          if (!note) setNote(t.rcPassTitleTrapNote);
                          setMessage(t.rcPassTitleTrapMsg);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-control border border-catch/30 bg-catch-wash px-3 py-1.5 text-xs font-semibold text-catch-ink hover:bg-catch-wash/80 disabled:opacity-50"
                      >
                        <ShieldAlert size={13} />
                        {t.rcPassTitleTrapBtn}
                      </button>
                    )}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-ink-2">
                    {t.rcTitleRiskDesc}
                  </p>

                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-control border border-line bg-paper/70 p-3.5 text-xs">
                      <span className="text-label font-bold uppercase tracking-wider text-ink-3">{t.rcForeclosingPartyLabel}</span>
                      <p className="mt-1 font-bold text-ink truncate">
                        {plaintiff ? sourceDisplayText(plaintiff) : t.rcUnpublishedPlaintiff}
                      </p>
                      <span className={cn(
                        "mt-1.5 inline-block text-label font-bold uppercase px-2 py-0.5 rounded",
                        isJuniorLien ? "bg-catch-wash text-catch-ink border border-catch/30" :
                        isHoaPlaintiff ? "bg-catch-wash text-catch-ink border border-catch/30" :
                        "bg-paper text-ink"
                      )}>
                        {isJuniorLien ? t.rcJuniorLienBadge : isHoaPlaintiff ? t.rcHoaLienBadge : t.rcSeniorPosBadge}
                      </span>
                    </div>

                    <div className="rounded-control border border-line bg-paper/70 p-3.5 text-xs">
                      <span className="text-label font-bold uppercase tracking-wider text-ink-3">{t.rcFedTaxLienLabel}</span>
                      <p className="mt-1 font-bold text-ink">
                        {isIrsLien ? t.rcIrsRedemptionActive : t.rcNoIrsFlag}
                      </p>
                      <span className={cn(
                        "mt-1.5 inline-block text-label font-bold uppercase px-2 py-0.5 rounded",
                        isIrsLien ? "bg-catch-wash text-catch-ink border border-catch/30" : "bg-paper text-ink-2"
                      )}>
                        {isIrsLien ? t.rcActiveRedemptionWin : t.rcClearOfIrs}
                      </span>
                    </div>

                    <div className="rounded-control border border-line bg-paper/70 p-3.5 text-xs">
                      <span className="text-label font-bold uppercase tracking-wider text-ink-3">{t.rcHoaSuperLabel}</span>
                      <p className="mt-1 font-bold text-ink">
                        {state === "NV" ? t.rcHoaNvStatus : state === "FL" ? t.rcHoaFlStatus : isSuperState ? interpolate(t.rcHoaUcioaStatus, { state }) : interpolate(t.rcHoaStdStatus, { state })}
                      </p>
                      <span className={cn(
                        "mt-1.5 inline-block text-label font-bold uppercase px-2 py-0.5 rounded",
                        isSuperState ? "bg-yours-wash text-yours border border-yours/30" : "bg-paper text-ink-2"
                      )}>
                        {state === "NV" ? t.rcHoaExtinguishes : isSuperState ? t.rcHoaSuperAssessment : t.rcHoaSubordinateFirst}
                      </span>
                    </div>
                  </div>

                  {isJuniorLien && (
                    <div className="mt-4 rounded-control border border-catch/30 bg-catch-wash p-4 text-xs text-catch-ink">
                      <strong className="block font-bold uppercase tracking-wide text-catch-ink">
                        {t.rcValueTrapHeading}
                      </strong>
                      <p className="mt-1 text-xs leading-relaxed text-catch-ink">
                        {t.rcValueTrapBody}
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
                      <h2 className="text-xl font-semibold">{t.rcDocketHeading}</h2>
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
                        setMessage(interpolate(t.rcMsgAppliedTrial, { decision: docket.recommendedDecision.toUpperCase(), count: docket.recommendedReasonCodes.length }));
                      }}
                      className="inline-flex items-center gap-1.5 rounded-control border border-line-strong bg-paper px-3 py-1.5 text-xs font-semibold text-ink hover:bg-paper disabled:opacity-50"
                    >
                      <Gavel size={13} />
                      {t.rcApplyTrialBtn}
                    </button>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-ink-2">
                    {t.rcDocketDesc}
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
                      <span className="text-label font-bold uppercase tracking-wider text-catch-ink">{t.rcFatalKillers}</span>
                      <p className="mt-0.5 text-lg font-black text-ink">{docket.fatalCount}</p>
                    </div>
                    <div className="rounded-control border border-catch/30 bg-catch-wash/40 p-3">
                      <span className="text-label font-bold uppercase tracking-wider text-catch-ink">{t.rcCautionPoints}</span>
                      <p className="mt-0.5 text-lg font-black text-ink">{docket.cautionCount}</p>
                    </div>
                    <div className="rounded-control border border-line bg-paper p-3">
                      <span className="text-label font-bold uppercase tracking-wider text-ink">{t.rcDefensesVerified}</span>
                      <p className="mt-0.5 text-lg font-black text-ink">{interpolate(t.rcOfTotal, { count: docket.defenseCount, total: docket.defensePoints.length })}</p>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-4 lg:grid-cols-2 text-xs">
                    <div className="space-y-2 rounded-control border border-line bg-paper/50 p-4">
                      <div className="flex items-center justify-between border-b border-line pb-2">
                        <div className="flex items-center gap-1.5 font-bold text-ink">
                          <Gavel size={14} className="text-catch-ink" />
                          <span>{t.rcProsVectors}</span>
                        </div>
                        <span className="text-label font-semibold text-ink-3">{t.rcSevenCheckpoints}</span>
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
                                {item.status === "disqualified" ? t.rcStatusDisq : item.status === "caution" ? t.rcStatusCaution : t.rcStatusPreAuction}
                              </span>
                            </div>
                            <p className="mt-1 text-xs leading-relaxed text-ink-2">{item.finding}</p>
                            <span className="mt-1 block text-label text-ink-3">{interpolate(t.rcStatutePrefix, { statute: item.statute })}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="space-y-2 rounded-control border border-line bg-paper/50 p-4">
                      <div className="flex items-center justify-between border-b border-line pb-2">
                        <div className="flex items-center gap-1.5 font-bold text-ink">
                          <ShieldCheck size={14} className="text-ink" />
                          <span>{t.rcDefShields}</span>
                        </div>
                        <span className="text-label font-semibold text-ink-3">{t.rcFourDefenses}</span>
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
                                {item.status === "verified" ? t.rcStatusVerified : t.rcStatusPending}
                              </span>
                            </div>
                            <p className="mt-1 text-xs leading-relaxed text-ink-2">{item.finding}</p>
                            <span className="mt-1 block text-label text-ink-3">{interpolate(t.rcAuthorityPrefix, { statute: item.statute })}</span>
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
                      <h2 className="text-xl font-semibold">{t.rcScenarioHeading}</h2>
                    </div>
                    {localScenario && (hasDiff || !serverScenario) && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void syncLocalScenario()}
                        className="inline-flex items-center gap-1.5 rounded-control border border-line-strong bg-paper px-3 py-1.5 text-xs font-semibold text-ink hover:bg-paper disabled:opacity-50"
                      >
                        <Save size={13} />
                        {t.rcSyncLocalBtn}
                      </button>
                    )}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-ink-2">
                    {t.rcScenarioDesc}
                  </p>
                  {effectiveScenario ? (
                    <div className="mt-5 space-y-4">
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <div className="rounded-control bg-paper p-3.5 border border-line">
                          <span className="text-label font-bold uppercase tracking-wider text-ink-2">{t.rcValLabel}</span>
                          <p className="mt-1 text-sm font-bold text-ink">
                            {effectiveScenario.customValuation ? fmtMoney(Number(effectiveScenario.customValuation)) : t.rcMarketBench}
                          </p>
                        </div>
                        <div className="rounded-control bg-paper p-3.5 border border-line">
                          <span className="text-label font-bold uppercase tracking-wider text-ink-2">{t.rcAssumedBidLabel}</span>
                          <p className="mt-1 text-sm font-bold text-ink">
                            {effectiveScenario.customOpeningBid ? fmtMoney(Number(effectiveScenario.customOpeningBid)) : (typeof detail.case.openingBid === "number" ? fmtMoney(detail.case.openingBid) : t.rcUnpublished)}
                          </p>
                        </div>
                        <div className="rounded-control bg-paper p-3.5 border border-line">
                          <span className="text-label font-bold uppercase tracking-wider text-ink-2">{t.rcMaoLabel}</span>
                          <p className="mt-1 text-sm font-bold text-ink">
                            {typeof effectiveScenario.maxAllowableOffer === "number" ? fmtMoney(effectiveScenario.maxAllowableOffer) : t.rcRequiresVal}
                          </p>
                        </div>
                        <div className="rounded-control bg-paper p-3.5 border border-line">
                          <span className="text-label font-bold uppercase tracking-wider text-ink-2">{t.rcRehabMarginLabel}</span>
                          <p className="mt-1 text-sm font-bold text-ink">
                            {fmtMoney(effectiveScenario.rehabBudget)} · {effectiveScenario.targetMargin}%
                          </p>
                        </div>
                      </div>
                      <div className="rounded-control bg-paper p-4 text-xs text-ink-2 space-y-1.5">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-ink font-semibold">
                          <span>{interpolate(t.rcHoldPeriodLine, { months: effectiveScenario.holdingMonths || 6 })}</span>
                          <Link href={`/listings/${encodeURIComponent(detail.case.listingId)}#due-diligence-binder`} className="text-ink underline hover:text-ink-2 text-xs font-semibold">
                            {t.rcTuneInTerminal}
                          </Link>
                        </div>
                        <p className="text-xs text-ink-3">
                          {interpolate(t.rcScenarioFeesLine, {
                            transfer: fmtMoneyStr(effectiveScenario.transferTax),
                            taxes: fmtMoneyStr(effectiveScenario.delinquentTaxes),
                            settlement: fmtMoneyStr(effectiveScenario.settlementCosts),
                            premium: fmtMoneyStr(effectiveScenario.buyersPremium),
                            poundage: fmtMoneyStr(effectiveScenario.sheriffPoundage),
                          })}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-control bg-paper p-4 text-xs text-ink-2 border border-line">
                      <p>{t.rcNoScenario}</p>
                      <p className="mt-1">
                        <Link href={`/listings/${encodeURIComponent(detail.case.listingId)}#due-diligence-binder`} className="text-ink underline font-semibold">
                          {t.rcOpenSimLink}
                        </Link>{" "}
                        {t.rcOpenSimSuffix}
                      </p>
                    </div>
                  )}
                </section>
              );
            })()}
            <section className="rounded-card border border-line bg-card p-5 sm:p-7"><div className="flex items-center gap-2"><GitCompareArrows size={19} className="text-ink" /><h2 className="text-xl font-semibold">{t.rcEvidenceCompHeading}</h2></div><p className="mt-2 text-xs leading-5 text-ink-2">{t.rcEvidenceCompDesc}</p><div className="mt-5 grid gap-4 md:grid-cols-2"><ClaimColumn title={t.rcPubRecordCol} claims={detail.dossier.claimGroups?.publisher || []} empty={t.rcPubEmpty} fallbackTitle={t.rcRecordedClaimFallback} sourceLabel={t.rcSourceLink} unknownLabel={t.alUnknown} locale={locale} /><ClaimColumn title={t.rcOffRecordCol} claims={detail.dossier.claimGroups?.official || []} empty={t.rcOffEmpty} fallbackTitle={t.rcRecordedClaimFallback} sourceLabel={t.rcSourceLink} unknownLabel={t.alUnknown} locale={locale} /></div>{(detail.dossier.signals || []).length > 0 && <div className="mt-5 border-t border-line pt-5"><h3 className="text-sm font-semibold">{t.rcConflictsHeading}</h3><div className="mt-3 space-y-2">{detail.dossier.signals?.map((signal, index) => <div key={index} className="rounded-control bg-catch-wash p-4 text-xs leading-5 text-catch-ink"><p className="font-semibold">{sourceDisplayText(signal.title || signal.type || t.rcSignalTitleFallback)}</p><p className="mt-1">{sourceDisplayText(signal.reason || t.rcSignalReasonFallback)}</p></div>)}</div></div>}</section>

            <section className="rounded-card border border-line bg-card p-5 sm:p-7"><div className="flex items-center gap-2"><ShieldQuestion size={19} className="text-ink" /><h2 className="text-xl font-semibold">{t.rcInvestNextHeading}</h2></div><div className="mt-4 space-y-3">{(detail.dossier.gaps || []).map((gap, index) => <article key={gap.key || index} className="rounded-control bg-paper p-4"><h3 className="text-sm font-semibold">{sourceDisplayText(gap.title || gap.key || t.rcGapTitleFallback)}</h3><p className="mt-2 text-xs leading-5 text-ink-2">{sourceDisplayText(gap.reason || t.rcGapReasonFallback)}</p>{gap.nextAction && <p className="mt-2 text-xs font-semibold text-ink">{t.alNextPrefix} {sourceDisplayText(gap.nextAction)}</p>}</article>)}{!(detail.dossier.gaps || []).length && <p className="text-sm text-ink-2">{t.rcNoOpenGaps}</p>}<button type="button" disabled={busy} onClick={() => void recheckSource()} className="inline-flex items-center gap-2 rounded-control border border-line-strong px-3 py-2 text-xs font-semibold disabled:opacity-50"><RotateCcw size={14} />{t.rcRecheckSavedBtn}</button></div></section>

            <section className="rounded-card border border-line bg-card p-5 sm:p-7"><div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><FileCheck2 size={19} className="text-ink" /><h2 className="text-xl font-semibold">{t.rcReviewedEvidenceHeading}</h2></div><button type="button" disabled={busy} onClick={() => void loadEvidence()} className="rounded-control border border-line px-3 py-2 text-xs font-semibold">{t.rcLoadReviewQueueBtn}</button></div><div className="mt-4 space-y-3">{detail.case.evidenceLinks.map((link) => <article key={link.intakeId} className="rounded-control bg-paper p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold">{relationshipLabels[link.relationship] || sourceDisplayText(link.relationship.replaceAll("_", " "))}</p><a href={link.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 break-all text-xs text-ink underline hover:text-ink-2">{t.rcOpenExactEvidence} <ExternalLink size={12} /></a><p className="mt-2 text-label text-ink-2">SHA-256 {link.contentSha256}</p></div><button type="button" aria-label={t.rcUnlinkEvidenceAria} disabled={busy} onClick={() => void unlinkEvidence(link.intakeId)} className="rounded-control p-2 hover:bg-paper"><Trash2 size={15} /></button></div></article>)}{!detail.case.evidenceLinks.length && <p className="text-sm text-ink-2">{t.rcNoAttachments}</p>}</div>{intake.length > 0 && <div className="mt-5 grid gap-2 border-t border-line pt-5 sm:grid-cols-[1fr_180px_auto]"><select aria-label={t.rcSelectEvidenceAria} value={selectedEvidence} onChange={(event) => setSelectedEvidence(event.target.value)} className="rounded-control border border-line bg-card px-3 py-2 text-xs">{intake.map((item) => <option key={item.id} value={item.id}>{sourceDisplayText(item.sourceId)} · {item.id}</option>)}</select><select aria-label={t.rcSelectRelAria} value={relationship} onChange={(event) => setRelationship(event.target.value)} className="rounded-control border border-line bg-card px-3 py-2 text-xs">{relationships.map((item) => <option key={item} value={item}>{relationshipLabels[item] || item.replaceAll("_", " ")}</option>)}</select><button type="button" disabled={busy || !selectedEvidence} onClick={() => void linkEvidence()} className="inline-flex items-center justify-center gap-1 rounded-control bg-ink px-3 py-2 text-xs font-semibold text-white"><Link2 size={13} />{t.rcLinkBtn}</button></div>}<p className="mt-4 text-xs leading-5 text-ink-2">{t.rcAttachmentBoundary}</p></section>

            <section className="rounded-card border border-line bg-card p-5 sm:p-7"><div className="flex items-center gap-2"><History size={19} className="text-ink" /><h2 className="text-xl font-semibold">{t.rcTimelineHeading}</h2></div><ol className="mt-5 space-y-4">{detail.case.timeline.map((entry, index) => <li key={entry.id || index} className="relative border-l-2 border-line pl-5"><span className="absolute -left-[6px] top-1 h-2.5 w-2.5 rounded-full bg-ink" /><p className="text-xs font-semibold">{sourceDisplayText(entry.type.replaceAll("_", " "))}</p><p className="mt-1 text-xs text-ink-2">{interpolate(t.rcTimelineRevision, { date: fmtDateTime(entry.at), revision: entry.revision || "—" })}</p></li>)}</ol></section>
          </div>

          <aside className="rounded-card border border-line bg-card p-5 xl:sticky xl:top-24"><h2 className="text-xl font-semibold">{t.rcRecordDecisionHeading}</h2><p className="mt-2 text-xs leading-5 text-ink-2">{t.rcRecordDecisionDesc}</p><div className="mt-5 grid grid-cols-3 gap-2">{(["inbox", "pursue", "pass"] as const).map((value) => <button key={value} type="button" aria-pressed={decisionState === value} onClick={() => setDecisionState(value)} className={`rounded-control px-3 py-2.5 text-xs font-semibold ${decisionState === value ? "bg-ink text-white" : "border border-line"}`}>{stateLabels[value]}</button>)}</div>
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
                      <strong className="block font-bold">{t.rcAsideFatalTitle}</strong>
                      <p className="text-xs leading-relaxed text-catch-ink">
                        {t.rcAsideFatalDescPrefix} <strong>{t.rcAsideFatalPassWord}</strong>.
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
                          {t.rcApplyInjunctionPassBtn}
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
                    <strong className="block font-bold uppercase tracking-wider">{t.rcAsideTrapTitle}</strong>
                    <p className="text-xs leading-relaxed">
                      {t.rcAsideTrapBody}
                    </p>
                    {decisionState !== "pass" && (
                      <button
                        type="button"
                        onClick={() => {
                          setDecisionState("pass");
                          setReasonCodes((prev) => [...new Set([...prev, "title_risk_unresolved"])]);
                          if (!note) setNote(t.rcPassTitleTrapNote);
                        }}
                        className="mt-1.5 inline-flex items-center gap-1 rounded bg-catch-ink px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90"
                      >
                        {t.rcPassValueTrapBtn}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {decisionState !== "inbox" && <fieldset className="mt-5"><legend className="text-xs font-semibold">{t.rcReasonsLegend} {decisionState === "pass" ? t.rcReasonsMinOne : ""}</legend><div className="mt-3 space-y-2">{reasonChoices.map(([value, title]) => <label key={value} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={reasonCodes.includes(value)} onChange={(event) => setReasonCodes(event.target.checked ? [...reasonCodes, value] : reasonCodes.filter((item) => item !== value))} />{title}</label>)}</div></fieldset>}
            <label className="mt-5 block text-xs font-semibold">{t.rcDecisionNoteLabel}<textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} rows={4} className="mt-2 w-full rounded-control border border-line p-3 text-sm font-normal" placeholder={t.rcDecisionNotePlaceholder} /></label>
            {decisionState === "pass" && <div className="mt-5 border-t border-line pt-5"><div className="flex items-center gap-2"><RotateCcw size={16} className="text-ink" /><h3 className="text-sm font-semibold">{t.rcBringBackHeading}</h3></div><select aria-label={t.rcReconsiderMatchingAria} value={mode} onChange={(event) => setMode(event.target.value as "any" | "all")} className="mt-3 w-full rounded-control border border-line bg-card px-3 py-2 text-xs"><option value="any">{t.rcMatchAny}</option><option value="all">{t.rcMatchAll}</option></select><div className="mt-3 space-y-3">{conditions.map((condition, index) => <ConditionEditor key={index} condition={condition} onChange={(next) => setConditions(conditions.map((item, itemIndex) => itemIndex === index ? next : item))} onRemove={conditions.length > 1 ? () => setConditions(conditions.filter((_, itemIndex) => itemIndex !== index)) : undefined} />)}</div><button type="button" disabled={conditions.length >= 10} onClick={() => setConditions([...conditions, { field: "saleDate", operator: "changed" }])} className="mt-3 text-xs font-semibold text-ink underline hover:text-ink-2 disabled:opacity-50">{t.rcAddConditionBtn}</button></div>}
            <button type="button" disabled={busy || (decisionState === "pass" && reasonCodes.length === 0)} onClick={() => void saveDecision()} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-control bg-ink px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}{t.rcSaveDecisionBtn}</button>
            <div className="mt-5 rounded-control bg-paper p-4 text-xs leading-5 text-ink-2"><p className="flex items-center gap-2 font-semibold text-ink"><Clock3 size={14} />{t.rcReproHeading}</p><p className="mt-1">{interpolate(t.rcReproBody, { revision: detail.case.revision })}</p></div>
          </aside>
        </div>
      </>}
    </PrivateWorkspaceGate>
  </div>;
}

function ClaimColumn({
  title,
  claims,
  empty,
  fallbackTitle,
  sourceLabel,
  unknownLabel,
  locale,
}: {
  title: string;
  claims: Claim[];
  empty: string;
  fallbackTitle: string;
  sourceLabel: string;
  unknownLabel: string;
  locale: Locale;
}) {
  return <div className="rounded-control border border-line p-4"><h3 className="text-sm font-semibold">{title}</h3><dl className="mt-3 space-y-3">{claims.map((claim, index) => <div key={`${claim.key || claim.title}-${index}`}><dt className="text-label font-bold uppercase tracking-wider text-ink-2">{claimName(claim, fallbackTitle)}</dt><dd className="mt-1 break-words text-sm font-semibold">{show(claim.value, locale, unknownLabel)}</dd>{claim.sourceUrl && <a href={claim.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-label text-ink underline hover:text-ink-2">{sourceLabel} <ExternalLink size={10} /></a>}</div>)}{!claims.length && <p className="text-xs leading-5 text-ink-2">{empty}</p>}</dl></div>;
}

function ConditionEditor({ condition, onChange, onRemove }: { condition: ReconsiderationCondition; onChange: (value: ReconsiderationCondition) => void; onRemove?: () => void }) {
  const { messages } = useLocale();
  const t = messages.researchB2;
  const numeric = condition.field === "openingBid" || condition.field === "sqft";
  const evidence = condition.field === "requiredEvidence";
  const titleRisk = condition.field === "titleRisk";
  const operatorOptions = evidence
    ? [["available", t.rcOpBecomesAvail]]
    : titleRisk
    ? [
        ["junior_lien_surviving_mortgage", t.rcOpJuniorTrap],
        ["irs_redemption_active", t.rcOpIrsActive],
        ["hoa_super_priority", t.rcOpHoaSuper],
        ["changed", t.rcOpTitleChanges],
      ]
    : condition.field === "openingBid"
    ? [
        ["changed", t.rcOpChanges],
        ["lte", t.rcOpLteUsd],
        ["gte", t.rcOpGteUsd],
        ["dropped_by_pct", t.rcOpDropPct],
        ["bid_to_assessed_lte", t.rcOpBidAssessed],
      ]
    : condition.field === "saleDate"
    ? [["changed", t.rcOpChanges], ["within_days", t.rcOpWithinDays]]
    : numeric
    ? [["changed", t.rcOpChanges], ["lte", t.rcOpLte], ["gte", t.rcOpGte]]
    : [["changed", t.rcOpChanges]];

  return <div className="rounded-control bg-paper p-3"><div className="flex gap-2"><select aria-label={t.rcCondFieldAria} value={condition.field} onChange={(event) => { const field = event.target.value as ReconsiderationCondition["field"]; onChange(field === "requiredEvidence" ? { field, operator: "available", value: "any" } : field === "titleRisk" ? { field, operator: "junior_lien_surviving_mortgage" } : { field, operator: "changed" }); }} className="min-w-0 flex-1 rounded-control border border-line bg-card px-2 py-2 text-xs"><option value="openingBid">{t.rcCondFieldBid}</option><option value="saleDate">{t.rcCondFieldSaleDate}</option><option value="status">{t.rcCondFieldStatus}</option><option value="sqft">{t.rcCondFieldSqft}</option><option value="requiredEvidence">{t.rcCondFieldEvidence}</option><option value="titleRisk">{t.rcCondFieldTitleRisk}</option></select>{onRemove && <button type="button" aria-label={t.rcCondRemoveAria} onClick={onRemove} className="rounded-control px-2 hover:bg-paper"><Trash2 size={14} /></button>}</div><select aria-label={t.rcCondOpAria} value={condition.operator} onChange={(event) => { const operator = event.target.value as ReconsiderationCondition["operator"]; const needsNumeric = operator === "lte" || operator === "gte" || operator === "dropped_by_pct" || operator === "bid_to_assessed_lte" || operator === "within_days"; onChange({ field: condition.field, operator, ...(needsNumeric ? { value: typeof condition.value === "number" && condition.value > 0 ? condition.value : operator === "dropped_by_pct" ? 10 : operator === "bid_to_assessed_lte" ? 65 : operator === "within_days" ? 14 : 0 } : operator === "available" ? { value: typeof condition.value === "string" ? condition.value : "any" } : {}) }); }} className="mt-2 w-full rounded-control border border-line bg-card px-2 py-2 text-xs">{operatorOptions.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select>{(condition.operator === "lte" || condition.operator === "gte" || condition.operator === "dropped_by_pct" || condition.operator === "bid_to_assessed_lte" || condition.operator === "within_days") && <input aria-label={t.rcCondThresholdAria} type="number" min={condition.operator === "within_days" || condition.operator === "dropped_by_pct" || condition.operator === "bid_to_assessed_lte" ? 1 : 0} max={condition.operator === "dropped_by_pct" || condition.operator === "bid_to_assessed_lte" ? 100 : condition.operator === "within_days" ? 365 : undefined} value={typeof condition.value === "number" ? condition.value : 0} onChange={(event) => onChange({ ...condition, value: Number(event.target.value) })} className="mt-2 w-full rounded-control border border-line bg-card px-2 py-2 text-xs" />}{condition.operator === "available" && <select aria-label={t.rcCondEvidenceTypeAria} value={typeof condition.value === "string" ? condition.value : "any"} onChange={(event) => onChange({ ...condition, value: event.target.value })} className="mt-2 w-full rounded-control border border-line bg-card px-2 py-2 text-xs"><option value="any">{t.rcEvAny}</option><option value="sale_terms">{t.rcRelSaleTerms}</option><option value="title_research">{t.rcRelTitleResearch}</option><option value="occupancy_research">{t.rcRelOccupancyResearch}</option><option value="valuation_research">{t.rcRelValuationResearch}</option></select>}</div>;
}
