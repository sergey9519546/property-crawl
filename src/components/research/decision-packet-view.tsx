'use client';

import { useEffect, useState } from 'react';
import { Download, Printer, ShieldAlert, CheckCircle2, DollarSign, Scale, FileText, Clock, Calendar, Building, Gavel, ShieldCheck } from 'lucide-react';
import { computeCashToClose, computeLienWaterfall, computeStatutoryDeadlinesAndCarry } from '@/lib/underwriting';
import { readUnderwriteScenario, scenarioCashInput } from '@/lib/underwrite-scenario';
import { evaluateAdversarialDocket } from '@/lib/adversarial-docket';
import { cn } from '@/lib/utils';

interface DecisionPacketViewProps {
  packet: any;
}

function moneyOrBlank(value: unknown, blank = 'Not entered') {
  return typeof value === 'number' && Number.isFinite(value) ? `$${value.toLocaleString()}` : blank;
}

function applyOperatorScenario(packet: any): { packet: any; diverged: boolean; overriddenFields: string[] } {
  const listingId = packet?.property?.id;
  const scenario = typeof listingId === 'string' ? readUnderwriteScenario(listingId) : null;
  if (!scenario) return { packet, diverged: false, overriddenFields: [] };

  let nextPacket = { ...packet };
  const overriddenFields: string[] = [];

  const existingAssumptions = packet?.underwritingAssumptions || {};
  if (typeof scenario.rehabBudget === 'number' && Number.isFinite(scenario.rehabBudget) && scenario.rehabBudget !== existingAssumptions.rehabBudget) {
    overriddenFields.push('rehabBudget');
  }
  if (typeof scenario.targetMargin === 'number' && Number.isFinite(scenario.targetMargin) && scenario.targetMargin !== existingAssumptions.targetMarginPct) {
    overriddenFields.push('targetMargin');
  }
  if (scenario.maxAllowableOffer !== undefined && scenario.maxAllowableOffer !== null && scenario.maxAllowableOffer !== existingAssumptions.maxAllowableOffer) {
    overriddenFields.push('maxAllowableOffer');
  }
  if (scenario.customValuation && scenario.customValuation !== String(existingAssumptions.customValuation ?? '')) {
    overriddenFields.push('customValuation');
  }
  if (scenario.customOpeningBid && scenario.customOpeningBid !== String(existingAssumptions.customOpeningBid ?? '')) {
    overriddenFields.push('customOpeningBid');
  }
  if (typeof scenario.holdingMonths === 'number' && scenario.holdingMonths > 0 && scenario.holdingMonths !== existingAssumptions.holdingMonths) {
    overriddenFields.push('holdingMonths');
  }
  if (typeof scenario.isHomestead === 'boolean' && scenario.isHomestead !== existingAssumptions.isHomestead) {
    overriddenFields.push('isHomestead');
  }

  nextPacket.underwritingAssumptions = {
    ...existingAssumptions,
    ...(typeof scenario.rehabBudget === 'number' && Number.isFinite(scenario.rehabBudget) ? { rehabBudget: scenario.rehabBudget } : {}),
    ...(typeof scenario.targetMargin === 'number' && Number.isFinite(scenario.targetMargin) ? { targetMarginPct: scenario.targetMargin } : {}),
    ...(scenario.maxAllowableOffer !== undefined ? { maxAllowableOffer: scenario.maxAllowableOffer } : {}),
    ...(scenario.customValuation ? { customValuation: scenario.customValuation } : {}),
    ...(scenario.customOpeningBid ? { customOpeningBid: scenario.customOpeningBid } : {}),
    ...(typeof scenario.holdingMonths === 'number' && scenario.holdingMonths > 0 ? { holdingMonths: scenario.holdingMonths } : {}),
    ...(typeof scenario.isHomestead === 'boolean' ? { isHomestead: scenario.isHomestead } : {}),
  };

  if (typeof scenario.maxAllowableOffer === 'number' && Number.isFinite(scenario.maxAllowableOffer)) {
    nextPacket.dispositionSignOff = {
      ...nextPacket.dispositionSignOff,
      maxAllowableOffer: nextPacket.dispositionSignOff?.maxAllowableOffer ?? scenario.maxAllowableOffer,
    };
  }

  const scenarioPrice = (typeof scenario.maxAllowableOffer === 'number' && Number.isFinite(scenario.maxAllowableOffer) && scenario.maxAllowableOffer > 0)
    ? scenario.maxAllowableOffer
    : (Number(scenario.customOpeningBid) > 0 ? Number(scenario.customOpeningBid) : (typeof packet?.property?.openingBid === 'number' ? packet.property.openingBid : null));
  if (scenarioPrice !== null && nextPacket.underwriting) {
    nextPacket.underwriting = {
      ...nextPacket.underwriting,
      statutoryDeadlinesAndCarry: computeStatutoryDeadlinesAndCarry({
        saleDate: packet?.property?.saleDate,
        state: packet?.property?.state,
        source: packet?.property?.source ?? packet?.provenance?.sourceId,
        distressType: packet?.property?.distressType,
        auctionProgram: packet?.property?.auctionProgram,
        isTaxSale: typeof packet?.property?.isTaxSale === 'boolean' ? packet.property.isTaxSale : undefined,
        purchasePrice: scenarioPrice,
        redemptionDays: nextPacket.underwriting?.titleRisk?.statutoryRedemptionDays,
        hasIrsLien: Boolean(nextPacket.underwriting?.titleRisk?.hasIrsTaxLien),
        isHomestead: typeof scenario.isHomestead === 'boolean' ? scenario.isHomestead : undefined,
      }),
    };
  }

  const entered = scenarioCashInput(scenario);
  if (Object.keys(entered).length > 0) {
    overriddenFields.push(...Object.keys(entered));
    const publishedOpeningBid = typeof packet?.property?.openingBid === 'number' ? packet.property.openingBid : null;
    const assumedOpeningBid = Number(scenario.customOpeningBid) > 0 ? Number(scenario.customOpeningBid) : null;
    const effectiveOpeningBid = publishedOpeningBid ?? assumedOpeningBid;
    const cash = computeCashToClose({ openingBid: effectiveOpeningBid, purchasePrice: effectiveOpeningBid, ...entered });
    const cashDueReady = cash.registrationFunds !== null && cash.creditedDeposit !== null && cash.cashDueAtSettlement !== null;
    nextPacket = {
      ...nextPacket,
      underwriting: {
        ...nextPacket.underwriting,
        cashToClose: {
          model: cash.model,
          acquisitionCostStatus: cash.acquisitionCostStatus,
          fundingTimingStatus: cash.fundingTimingStatus,
          totalAcquisitionCost: cash.totalAcquisitionCost,
          buyersPremium: cash.buyersPremium,
          sheriffPoundage: cash.sheriffPoundage,
          transferTax: cash.transferTax,
          delinquentTaxes: cash.delinquentTaxes,
          settlementCosts: cash.settlementCosts,
          registrationFunds: cash.registrationFunds,
          creditedDeposit: cash.creditedDeposit,
          cashDueAtSettlement: cashDueReady ? cash.cashDueAtSettlement : null,
          netCashDueAtSettlement: cashDueReady ? cash.cashDueAtSettlement : null,
          missingInputs: cash.missingInputs,
          assumptions: cash.assumptions,
          scenarioSource: 'listing-bid-cost-model',
        },
      },
    };
  }

  return {
    packet: nextPacket,
    diverged: overriddenFields.length > 0,
    overriddenFields: Array.from(new Set(overriddenFields)),
  };
}

function withOperatorScenario(packet: any) {
  return applyOperatorScenario(packet).packet;
}

export function DecisionPacketView({ packet }: DecisionPacketViewProps) {
  const [downloading, setDownloading] = useState(false);
  const [livePacket, setLivePacket] = useState(packet);
  const [scenarioDiverged, setScenarioDiverged] = useState(false);
  const [overriddenFields, setOverriddenFields] = useState<string[]>([]);
  const [exportNote, setExportNote] = useState<string | null>(null);

  useEffect(() => {
    const applied = applyOperatorScenario(packet);
    setLivePacket(applied.packet);
    setScenarioDiverged(applied.diverged);
    setOverriddenFields(applied.overriddenFields);
  }, [packet]);

  if (!livePacket) {
    return (
      <div className="p-8 text-center text-ink-3">
        <p>No decision packet data loaded.</p>
      </div>
    );
  }

  const p = livePacket.property || {};
  const u = livePacket.underwriting || {};
  const t = u.titleRisk || {};
  const c = u.cashToClose || {};
  const d = livePacket.dispositionSignOff || {};
  const a = livePacket.underwritingAssumptions || {};
  const m = u.macroValuation;
  const municipal = u.municipalSurvivability || {};
  const municipalCount = Number.isFinite(municipal.activeViolationsCount) ? municipal.activeViolationsCount : null;
  const priorityKnown = t.plaintiffType && t.plaintiffType !== 'UNKNOWN';
  const decisionRecorded = d.decision === 'BID' || d.decision === 'PASS' || d.decision === 'UNDERWRITE';
  const bidAmount = typeof p.openingBid === 'number' && p.openingBid > 0 ? p.openingBid : 0;
  // A surviving first mortgage has no published balance, so the waterfall is only
  // computed when nothing senior survives; otherwise we say the amount is unknown.
  const seniorBalanceUnknown = t.firstMortgageSurvives !== false || t.instrumentPriority?.priorityVerified !== true;
  const waterfall = bidAmount > 0 && !seniorBalanceUnknown
    ? computeLienWaterfall({
        winningBid: bidAmount,
        foreclosingLienType: t.firstMortgageSurvives ? "second_mortgage" : "first_mortgage",
        foreclosingLienAmount: null,
        seniorMortgageAmount: 0,
        delinquentTaxesAmount: typeof c.delinquentTaxes === 'number' ? c.delinquentTaxes : null,
        state: p.state,
      })
    : null;

  const deadlines = u.statutoryDeadlinesAndCarry || computeStatutoryDeadlinesAndCarry({
    saleDate: p.saleDate,
    state: p.state,
    source: p.source ?? livePacket?.provenance?.sourceId,
    distressType: p.distressType,
    auctionProgram: p.auctionProgram,
    isTaxSale: typeof p.isTaxSale === 'boolean' ? p.isTaxSale : undefined,
    purchasePrice: typeof d.maxAllowableOffer === 'number' ? d.maxAllowableOffer : null,
    redemptionDays: t.statutoryRedemptionDays,
    hasIrsLien: Boolean(t.hasIrsTaxLien)
  });

  const buildPacketPayload = () => {
    const scenario = typeof p.id === 'string' ? readUnderwriteScenario(p.id) : null;
    const cashOverrides = scenario ? scenarioCashInput(scenario) : {};
    return {
      disposition: decisionRecorded ? d.decision : 'UNDERWRITE',
      ...(typeof d.maxAllowableOffer === 'number' ? { maxAllowableOffer: d.maxAllowableOffer } : {}),
      ...(typeof a.rehabBudget === 'number' ? { rehabBudget: a.rehabBudget } : {}),
      ...(typeof a.targetMarginPct === 'number' ? { targetMargin: a.targetMarginPct } : {}),
      ...(a.customValuation ? { customValuation: Number(a.customValuation) || a.customValuation } : {}),
      ...(a.customOpeningBid ? { customOpeningBid: Number(a.customOpeningBid) || a.customOpeningBid } : {}),
      ...(typeof a.holdingMonths === 'number' && a.holdingMonths > 0 ? { holdingMonths: a.holdingMonths } : {}),
      ...(typeof a.isHomestead === 'boolean' ? { isHomestead: a.isHomestead } : {}),
      ...(typeof p.isTaxSale === 'boolean' ? { isTaxSale: p.isTaxSale } : {}),
      ...(typeof d.operatorNotes === 'string' && d.operatorNotes.trim() ? { operatorNotes: d.operatorNotes.trim() } : {}),
      ...(typeof d.operatorId === 'string' && d.operatorId.trim() ? { operatorId: d.operatorId.trim() } : {}),
      ...cashOverrides,
    };
  };

  const triggerDownload = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPacket = async (format: 'json' | 'markdown') => {
    setDownloading(true);
    setExportNote(null);
    const payload = buildPacketPayload();
    const ext = format === 'markdown' ? 'md' : 'json';
    const filename = `decision-packet-${p.id || 'property'}.${ext}`;
    const mimeType = format === 'markdown' ? 'text/markdown; charset=utf-8' : 'application/json';

    try {
      if (p.id) {
        const res = await fetch(`/api/listings/${encodeURIComponent(p.id)}/packet?format=${format}`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          if (format === 'json') {
            const signedPacket = await res.json();
            setLivePacket(signedPacket);
            setScenarioDiverged(false);
            setOverriddenFields([]);
            triggerDownload(JSON.stringify(signedPacket, null, 2), filename, mimeType);
          } else {
            const md = await res.text();
            triggerDownload(md, filename, mimeType);
          }
          setExportNote('Exported server-checksummed decision packet via POST.');
          return;
        }

        // Fall back to GET packet route when operator session is locked or unconfigured
        if (res.status === 401 || res.status === 403 || res.status === 503) {
          const qs = new URLSearchParams({ format });
          for (const [key, val] of Object.entries(payload)) {
            if (val !== undefined && val !== null && val !== '') {
              qs.set(key, String(val));
            }
          }
          const getRes = await fetch(`/api/listings/${encodeURIComponent(p.id)}/packet?${qs.toString()}`, {
            credentials: 'same-origin',
          });
          if (getRes.ok) {
            const content = format === 'markdown' ? await getRes.text() : JSON.stringify(await getRes.json(), null, 2);
            triggerDownload(content, filename, mimeType);
            setExportNote('Exported read-only decision packet (unlock operator session for signed POST mutations).');
            return;
          }
        }
      }
    } catch {
      // Network fallback handled below
    } finally {
      setDownloading(false);
    }

    if (format === 'json') {
      triggerDownload(JSON.stringify(livePacket, null, 2), filename, mimeType);
      setExportNote('Exported local preview JSON (server packet endpoint unreachable).');
    } else {
      setExportNote('Unable to reach server Markdown formatter while offline.');
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6 text-ink font-sans print:p-0 print:max-w-none">
      {/* Header bar / Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4 print:hidden">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink">Evidentiary Decision Packet</h1>
          <p className="text-xs text-ink-3">Foreclosure due diligence dossier for courthouse auction bidding</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handlePrint}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-control border border-line-strong bg-card text-xs font-semibold text-ink-2 hover:bg-paper transition"
          >
            <Printer className="w-3.5 h-3.5" />
            Print Dossier
          </button>
          <button
            onClick={() => handleExportPacket('markdown')}
            disabled={downloading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-control border border-line-strong bg-card text-xs font-semibold text-ink hover:bg-paper transition"
          >
            <FileText className="w-3.5 h-3.5" />
            Export Markdown
          </button>
          <button
            onClick={() => handleExportPacket('json')}
            disabled={downloading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-control bg-ink text-white text-xs font-semibold hover:bg-ink-2 transition"
          >
            <Download className="w-3.5 h-3.5" />
            Export JSON
          </button>
        </div>
      </div>

      {/* Packet Provenance Banner */}
      <div className="bg-ink text-paper p-4 rounded-control space-y-1.5 text-xs font-mono">
        <div className="flex flex-wrap justify-between items-center text-ink-3 text-xs">
          <span>PACKET ID: {livePacket.packetId}</span>
          <span>TIMESTAMP: {livePacket.createdAt}</span>
        </div>
        <div className="truncate text-paper/85">
          INTEGRITY CHECKSUM (SHA-256): <span className="text-signature font-bold">{livePacket.integrityChecksum}</span>
        </div>
      </div>

      {scenarioDiverged && (
        <div
          role="status"
          data-testid="scenario-checksum-divergence"
          className="rounded-control border border-catch/40 bg-catch-wash p-4 text-xs text-catch-ink space-y-1"
        >
          <div className="flex items-center gap-2 font-bold">
            <ShieldAlert className="h-4 w-4 shrink-0 text-catch-ink" />
            <span>Local Underwriting Override Active — Diverges from Server Integrity Checksum</span>
          </div>
          <p className="leading-relaxed text-catch-ink">
            This browser session applies local assumptions ({overriddenFields.join(', ')}) on top of the server-signed packet ({livePacket.integrityChecksum?.slice(0, 12)}…).
            Click <strong>Export JSON</strong> or <strong>Export Markdown</strong> while unlocked to generate a freshly checksummed server packet.
          </p>
        </div>
      )}

      {exportNote && (
        <p className="text-xs font-medium text-ink-2 print:hidden">{exportNote}</p>
      )}

      {/* Property Overview Card */}
      <div className="bg-card border border-line rounded-control p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap justify-between items-start gap-2">
          <div>
            <span className="text-label font-bold uppercase tracking-wider text-ink-2 bg-paper px-2 py-0.5 rounded border border-line">
              {p.state} · {p.county}
            </span>
            <h2 className="text-lg font-bold text-ink mt-1">{p.address}</h2>
            <p className="text-xs text-ink-3">{p.city}, {p.state} {p.zip} · {p.propType}</p>
          </div>
          <div className="text-right">
            <span className="text-xs text-ink-3">Opening Bid</span>
            <p className="text-2xl font-black text-ink">{moneyOrBlank(p.openingBid, 'Not published')}</p>
            <span className="text-label text-ink-3">{p.caseNumber ? `Case #${p.caseNumber}` : "Case not published"}</span>
          </div>
        </div>
      </div>

      {/* Adversarial Trial Docket Audit */}
      {(() => {
        const docket = p ? evaluateAdversarialDocket(p) : null;
        if (!docket) return null;
        return (
          <div data-testid="packet-trial-docket-section" className="bg-card border border-line rounded-control p-5 shadow-sm space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
              <div className="flex items-center gap-2">
                <Scale className="w-4 h-4 text-ink" />
                <h3 className="font-bold text-sm text-ink">Adversarial Trial Docket (Prosecution vs. Defense)</h3>
              </div>
              <span className={cn(
                "text-label font-bold uppercase tracking-wider px-2 py-0.5 rounded border",
                docket.badgeClass
              )}>
                {docket.headline}
              </span>
            </div>
            <p className="text-xs text-ink-2 leading-relaxed">{docket.verdictDescription}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs pt-1">
              <div className="p-3 rounded-control bg-paper border border-line space-y-1.5">
                <span className="font-bold text-ink flex items-center gap-1.5">
                  <Gavel className="w-3.5 h-3.5 text-catch-ink" />
                  Prosecution Deal-Killers ({docket.fatalCount} fatal, {docket.cautionCount} cautions)
                </span>
                <ul className="space-y-1 text-xs text-ink-2">
                  {docket.prosecutionPoints.filter(pt => pt.status === "disqualified" || pt.status === "caution").slice(0, 3).map(pt => (
                    <li key={pt.id} className="flex items-start gap-1">
                      <span className="text-catch-ink font-bold">·</span>
                      <span><strong>{pt.title}:</strong> {pt.statute}</span>
                    </li>
                  ))}
                  {docket.fatalCount === 0 && docket.cautionCount === 0 && (
                    <li className="text-ink-3 italic">No fatal title defects detected.</li>
                  )}
                </ul>
              </div>
              <div className="p-3 rounded-control bg-paper border border-line space-y-1.5">
                <span className="font-bold text-ink flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-ink-2" />
                  Defense Shields ({docket.defenseCount} of {docket.defensePoints.length} verified)
                </span>
                <ul className="space-y-1 text-xs text-ink-2">
                  {docket.defensePoints.map(pt => (
                    <li key={pt.id} className="flex items-start gap-1">
                      <span className="text-ink-2 font-bold">·</span>
                      <span><strong>{pt.title}:</strong> {pt.status === "verified" ? "Verified" : "Pending"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Underwriting Grids */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Title Risk Matrix */}
        <div className="bg-card border border-line rounded-control p-5 shadow-sm space-y-3">
          <div className="flex items-center gap-2 border-b border-line pb-2">
            <Scale className="w-4 h-4 text-catch" />
            <h3 className="font-bold text-sm text-ink">Statutory Title Risk</h3>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-line">
              <span className="text-ink-3">Foreclosing Party:</span>
              <span className="font-semibold">{t.plaintiffType}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-line">
              <span className="text-ink-3">Senior 1st Mortgage:</span>
              <span className={priorityKnown && t.firstMortgageSurvives ? "text-catch-ink font-bold" : "font-semibold text-ink"}>
                {priorityKnown ? (t.firstMortgageSurvives ? "SURVIVES FORECLOSURE" : "No senior-lien flag in the published plaintiff text") : "Not established"}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-line">
              <span className="text-ink-3">IRS Tax Lien (26 U.S.C. § 7425):</span>
              <span className="font-semibold">{t.hasIrsTaxLien ? `Phrase in the supplied record (${t.irsRedemptionDays}d)` : "No IRS phrase in the supplied record"}</span>
            </div>
            {Number.isFinite(t.statutoryRedemptionDays) ? (
              <div className="flex justify-between py-1 border-b border-line" data-testid="recorded-redemption">
                <span className="text-ink-3">Recorded redemption:</span>
                <span className="font-semibold">{t.statutoryRedemptionDays} days</span>
              </div>
            ) : null}
          </div>
          {(Array.isArray(t.titleWarnings) && t.titleWarnings.length > 0) || t.titleActionAdvice ? (
            <div className="mt-3 p-2.5 rounded-control bg-catch-wash border border-catch/30 text-xs text-catch-ink space-y-1">
              {(Array.isArray(t.titleWarnings) ? t.titleWarnings : []).map((warning: string, i: number) => (
                <div key={i} className="flex items-start gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 text-catch-ink shrink-0 mt-0.5" />
                  <span>{warning}</span>
                </div>
              ))}
              {t.titleActionAdvice ? (
                <p className="pt-1 border-t border-catch/30 font-medium text-catch-ink">{t.titleActionAdvice}</p>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Cash to Close Schedule */}
        <div className="bg-card border border-line rounded-control p-5 shadow-sm space-y-3">
          <div className="flex items-center gap-2 border-b border-line pb-2">
            <DollarSign className="w-4 h-4 text-ink-2" />
            <h3 className="font-bold text-sm text-ink">Cash requirement</h3>
          </div>
          <p className="text-xs leading-relaxed text-ink-3">No fee is inferred from the source or the state. Blank lines were not entered. Registration funds are not added again.</p>
          <div className="space-y-2 text-xs">
            {[
              ["Buyer premium", c.buyersPremium],
              ["Sheriff / trustee fee", c.sheriffPoundage],
              ["Transfer tax", c.transferTax],
              ["Taxes or debt the buyer must satisfy", c.delinquentTaxes],
              ["Other settlement / recording costs", c.settlementCosts],
              ["Registration funds", c.registrationFunds],
              ["Deposit credited to the price", c.creditedDeposit],
            ].map(([label, value]) => (
              <div key={String(label)} className="flex justify-between gap-3 py-1 border-b border-line">
                <span className="text-ink-3">{label}:</span>
                <span className="font-semibold">{moneyOrBlank(value)}</span>
              </div>
            ))}
            <div className="flex justify-between gap-3 py-1 border-b border-line">
              <span className="text-ink-3">Acquisition cost:</span>
              <span className="font-semibold">{moneyOrBlank(c.totalAcquisitionCost)}</span>
            </div>
            <div className="flex justify-between gap-3 pt-2 border-t border-line font-bold text-sm">
              <span className="shrink-0">Cash to close:</span>
              <span className="text-ink">{moneyOrBlank(c.cashDueAtSettlement, "Blank until registration funds and the credited deposit are both entered")}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Section 4: Underwriting Assumptions & Strategy */}
      <div className="bg-card border border-line rounded-control p-5 shadow-sm space-y-3" data-testid="underwriting-assumptions-section">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-ink-2" />
            <h3 className="font-bold text-sm text-ink">Underwriting Assumptions &amp; Strategy</h3>
          </div>
          <span className="text-label font-bold uppercase tracking-wider text-ink-2 bg-paper px-2 py-0.5 rounded border border-line">
            Buyer Scenario Parameters
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-xs">
          <div className="p-3 rounded-control bg-paper border border-line">
            <span className="block text-ink-3">Max Allowable Offer (MAO)</span>
            <span className="mt-1 block text-sm font-bold text-ink">{moneyOrBlank(a.maxAllowableOffer ?? d.maxAllowableOffer)}</span>
          </div>
          <div className="p-3 rounded-control bg-paper border border-line">
            <span className="block text-ink-3">Estimated Rehab Budget</span>
            <span className="mt-1 block text-sm font-bold text-ink">{moneyOrBlank(a.rehabBudget)}</span>
          </div>
          <div className="p-3 rounded-control bg-paper border border-line">
            <span className="block text-ink-3">Target Profit Margin</span>
            <span className="mt-1 block text-sm font-bold text-ink">{typeof a.targetMarginPct === 'number' && Number.isFinite(a.targetMarginPct) ? `${a.targetMarginPct}%` : 'Not entered'}</span>
          </div>
          <div className="p-3 rounded-control bg-paper border border-line">
            <span className="block text-ink-3">Strategy Disposition</span>
            <span className="mt-1 block text-sm font-bold text-ink">{a.disposition || (decisionRecorded ? d.decision : 'Not recorded')}</span>
          </div>
        </div>
      </div>

      {/* Statutory Deadlines & Capital Holding Carry */}
      {deadlines && (
        <div className="bg-card border border-line rounded-control p-5 shadow-sm space-y-3" data-testid="statutory-deadlines-carry">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-yours" />
              <h3 className="font-bold text-sm text-ink">Statutory Deadlines & Capital Holding Carry</h3>
            </div>
            <span className="text-label font-bold uppercase tracking-wider text-yours bg-yours-wash px-2 py-0.5 rounded border border-yours/30">
              Lockup: {deadlines.effectiveLockupDays} Days
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="space-y-2">
              <div className="flex justify-between py-1 border-b border-line">
                <span className="text-ink-3">Objection / Confirmation:</span>
                <span className="font-semibold text-right max-w-[240px]">
                  {deadlines.objectionLabel || `${deadlines.objectionOrConfirmationDays} days`}
                  {deadlines.objectionDeadline ? ` (${deadlines.objectionDeadline})` : ''}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-line">
                <span className="text-ink-3">IRS 120-Day Right (26 U.S.C. § 7425):</span>
                <span className="font-semibold">
                  {deadlines.irsRedemptionDays > 0
                    ? `${deadlines.irsRedemptionDays} days (${deadlines.irsRedemptionDeadline || 'pending'})`
                    : 'None (no IRS lien)'}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-line">
                <span className="text-ink-3">State Statutory Redemption:</span>
                <span className="font-semibold">
                  {deadlines.stateRedemptionDays > 0
                    ? `${deadlines.stateRedemptionDays} days (${deadlines.stateRedemptionDeadline || 'pending'})`
                    : (t.statutoryRedemptionDays === null ? 'Not published' : '0 days')}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-line">
                <span className="text-ink-3 font-medium">Effective Capital Lockup:</span>
                <span className="font-bold text-yours">{deadlines.effectiveLockupDays} days</span>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between py-1 border-b border-line">
                <span className="text-ink-3">Cost of Capital Rate:</span>
                <span className="font-semibold">{deadlines.annualCostOfCapitalPct}% annual</span>
              </div>
              <div className="flex justify-between py-1 border-b border-line">
                <span className="text-ink-3">Monthly Holding Carry:</span>
                <span className="font-semibold">{moneyOrBlank(deadlines.monthlyHoldingCost, 'Requires buyer-supplied price')}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-line">
                <span className="text-ink-3">Property Tax Carry ({deadlines.effectiveTaxRatePct}%):</span>
                <span className="font-semibold">{moneyOrBlank(deadlines.estimatedPropertyTaxCarry, 'Requires buyer-supplied price')}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-line">
                <span className="text-ink-3">Insurance Carry:</span>
                <span className="font-semibold">{moneyOrBlank(deadlines.estimatedInsuranceCarry, 'Requires buyer-supplied price')}</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-line font-bold">
                <span className="text-ink">Total Holding Cost Carry:</span>
                <span className="text-ink font-black">{moneyOrBlank(deadlines.totalHoldingCostCarry, 'Requires buyer-supplied price')}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Lien Priority & Waterfall Schedule */}
      {seniorBalanceUnknown && bidAmount > 0 && (
        <div className="rounded-control border border-catch/30 bg-catch-wash p-4 text-xs text-catch-ink" data-testid="lien-waterfall-unknown">
          <strong>Title priority and surviving balances require verification.</strong> The lien waterfall is not computed from a pattern flag. Pull the recorded instruments and payoffs before bidding.
        </div>
      )}
      {waterfall && (
        <div className="bg-card border border-line rounded-control p-5 shadow-sm space-y-3" data-testid="lien-waterfall-schedule">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
            <div className="flex items-center gap-2">
              <Scale className="w-4 h-4 text-ink" />
              <h3 className="font-bold text-sm text-ink">Lien Priority & Debt Extinguishment Waterfall</h3>
            </div>
            <span className={`text-label font-bold uppercase px-2 py-0.5 rounded ${(waterfall.totalSurvivingDebtOnProperty ?? 0) > 0 ? 'bg-catch-wash text-catch-ink' : 'bg-paper text-ink-2 border border-line'}`}>
              {!waterfall.complete ? 'Surviving balances unknown' : (waterfall.totalSurvivingDebtOnProperty ?? 0) > 0 ? `Supplied surviving debt: $${waterfall.totalSurvivingDebtOnProperty!.toLocaleString()}` : 'No surviving debt in supplied balances'}
            </span>
          </div>

          {waterfall.criticalAlert && (
            <div className="p-3 bg-catch-wash border border-catch/30 rounded-control text-xs text-catch-ink font-medium">
              {waterfall.criticalAlert}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line text-ink-3">
                  <th className="py-1.5 pr-2 font-semibold">Priority</th>
                  <th className="py-1.5 pr-2 font-semibold">Instrument / Lienholder</th>
                  <th className="py-1.5 pr-2 text-right font-semibold">Claim Amount</th>
                  <th className="py-1.5 pr-2 text-right font-semibold">Paid From Bid</th>
                  <th className="py-1.5 text-right font-semibold">Title Status on Property</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line font-medium">
                {waterfall.items.map((item) => (
                  <tr key={item.id} className="text-ink">
                    <td className="py-1.5 pr-2 font-bold text-ink-2">#{item.seniority}</td>
                    <td className="py-1.5 pr-2 font-semibold text-ink">
                      {item.name}
                      {item.isForeclosingLien && (
                        <span className="ml-1.5 rounded bg-yours-wash px-1 py-0.5 text-label font-bold text-yours">
                          Foreclosing
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-2 text-right">${item.amount.toLocaleString()}</td>
                    <td className="py-1.5 pr-2 text-right text-ink font-semibold">${item.amountPaidFromProceeds.toLocaleString()}</td>
                    <td className={`py-1.5 text-right font-bold ${item.remainingBalanceAgainstProperty > 0 ? 'text-catch-ink' : 'text-ink-3'}`}>
                      {item.remainingBalanceAgainstProperty > 0 ? `SURVIVES ($${item.remainingBalanceAgainstProperty.toLocaleString()})` : 'EXTINGUISHED'}
                    </td>
                  </tr>
                ))}
                {(waterfall.surplusProceedsToBorrower ?? 0) > 0 && (
                  <tr className="bg-paper font-semibold text-ink">
                    <td className="py-1.5 pr-2 text-label uppercase font-bold text-ink-2">Surplus</td>
                    <td className="py-1.5 pr-2" colSpan={2}>
                      Debtor / Mortgagor Surplus Proceeds
                    </td>
                    <td className="py-1.5 pr-2 text-right text-ink">
                      ${waterfall.surplusProceedsToBorrower!.toLocaleString()}
                    </td>
                    <td className="py-1.5 text-right text-ink-3">—</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-ink-2 leading-snug">{waterfall.summary}</p>
        </div>
      )}

      {/* HUD Small Area FMR & Section 8 Voucher Floor */}
      {livePacket.hudSafmr && (
        <div className="bg-card border border-line rounded-control p-5 shadow-sm space-y-3" data-testid="hud-safmr-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
            <div className="flex items-center gap-2">
              <Building className="w-4 h-4 text-ink-2" />
              <h3 className="font-bold text-sm text-ink">HUD Fair Market Rent (SAFMR) Benchmark</h3>
            </div>
            <span className="text-label font-bold uppercase tracking-wider text-ink-2 bg-paper px-2 py-0.5 rounded border border-line">
              ZIP {livePacket.hudSafmr.zip} · FY2025 Revised Section 8 FMR
            </span>
          </div>
          <p className="text-xs text-ink-3 leading-snug">
            Historical HUD rent benchmark. Actual payments depend on local program rules and property approval. The 90% and 110% figures are scenarios, not guaranteed rental income.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line text-ink-3">
                  <th className="py-1.5 pr-2 font-semibold">Unit Size</th>
                  <th className="py-1.5 pr-2 text-right font-semibold">Baseline FMR</th>
                  <th className="py-1.5 pr-2 text-right font-semibold">90% Benchmark Scenario</th>
                  <th className="py-1.5 text-right font-semibold">110% Benchmark Scenario</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line font-medium text-ink">
                {[
                  { label: '0 Bedroom (Efficiency)', key: '0br' },
                  { label: '1 Bedroom', key: '1br' },
                  { label: '2 Bedroom', key: '2br' },
                  { label: '3 Bedroom', key: '3br' },
                  { label: '4 Bedroom', key: '4br' },
                ].map(({ label, key }) => {
                  const base = livePacket.hudSafmr.rents?.[key];
                  const floor90 = livePacket.hudSafmr.paymentStandard90?.[key];
                  const ceil110 = livePacket.hudSafmr.paymentStandard110?.[key];
                  return (
                    <tr key={key}>
                      <td className="py-1.5 pr-2 font-semibold text-ink">{label}</td>
                      <td className="py-1.5 pr-2 text-right">{typeof base === 'number' ? `$${base.toLocaleString()}` : '—'}</td>
                      <td className="py-1.5 pr-2 text-right text-ink font-semibold">{typeof floor90 === 'number' ? `$${floor90.toLocaleString()}` : '—'}</td>
                      <td className="py-1.5 text-right font-semibold">{typeof ceil110 === 'number' ? `$${ceil110.toLocaleString()}` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-label text-ink-3 italic">
            Statutory Citation: 42 U.S.C. § 1437f(o)(1)(B); official HUD Small Area Fair Market Rent schedule.
          </p>
        </div>
      )}

      {municipalCount !== null && municipalCount > 0 && (
        <div className="bg-card border border-catch/30 rounded-control p-5 shadow-sm space-y-2" data-testid="municipal-violations">
          <h3 className="font-bold text-sm text-ink">Supplied municipal violations: {municipalCount}</h3>
          {Array.isArray(municipal.criticalAlerts) && municipal.criticalAlerts.map((alert: string) => (
            <p key={alert} className="text-xs leading-relaxed text-ink-2">{alert}</p>
          ))}
        </div>
      )}

      {/* Valuation Benchmark Banner */}
      {m && (
        <div className="bg-paper border border-line rounded-control p-4 text-xs space-y-1">
          <div className="flex justify-between items-center font-semibold text-ink">
            <span>Valuation band: ${m.estLow.toLocaleString()} – ${m.estHigh.toLocaleString()}</span>
            <span className="text-label uppercase font-bold text-ink-3 bg-card border border-line px-2 py-0.5 rounded">Macro Benchmark</span>
          </div>
          <p className="text-xs text-ink-3 leading-snug">{m.disclaimer}</p>
        </div>
      )}

      {/* Sign-Off Block */}
      <div className="bg-ink text-white p-5 rounded-control space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {decisionRecorded ? <CheckCircle2 className="w-5 h-5 text-go-fill" /> : <FileText className="w-5 h-5 text-white/70" />}
            <h4 className="font-bold text-sm">Operator disposition: {decisionRecorded ? d.decision : "Not recorded"}</h4>
          </div>
          {typeof d.maxAllowableOffer === "number" && (
            <span className="text-xs font-mono text-signature">MAO: ${d.maxAllowableOffer.toLocaleString()}</span>
          )}
        </div>
        <p className="text-xs text-paper/85 italic border-l-2 border-white/25 pl-3">
          "{d.operatorNotes || "No operator commentary recorded."}"
        </p>
        <div className="flex flex-wrap justify-between gap-2 text-label text-white/75 pt-2 border-t border-white/15">
          <span>Operator: {d.operatorId || "Not recorded"}</span>
          <span>{d.signedAt || "Not signed"}</span>
        </div>
      </div>
    </div>
  );
}

export default DecisionPacketView;
