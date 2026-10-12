'use client';

import { useEffect, useState } from 'react';
import { Download, Printer, ShieldAlert, CheckCircle2, DollarSign, Scale, FileText } from 'lucide-react';
import { computeCashToClose } from '@/lib/underwriting';
import { readUnderwriteScenario, scenarioCashInput } from '@/lib/underwrite-scenario';

interface DecisionPacketViewProps {
  packet: any;
}

function moneyOrBlank(value: unknown, blank = 'Not entered') {
  return typeof value === 'number' && Number.isFinite(value) ? `$${value.toLocaleString()}` : blank;
}

function withOperatorScenario(packet: any) {
  const listingId = packet?.property?.id;
  const scenario = typeof listingId === 'string' ? readUnderwriteScenario(listingId) : null;
  if (!scenario) return packet;
  const entered = scenarioCashInput(scenario);
  if (Object.keys(entered).length === 0) return packet;
  const openingBid = typeof packet?.property?.openingBid === 'number' ? packet.property.openingBid : null;
  const cash = computeCashToClose({ openingBid, purchasePrice: openingBid, ...entered });
  const cashDueReady = cash.registrationFunds !== null && cash.creditedDeposit !== null && cash.cashDueAtSettlement !== null;
  return {
    ...packet,
    underwriting: {
      ...packet.underwriting,
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

export function DecisionPacketView({ packet }: DecisionPacketViewProps) {
  const [downloading, setDownloading] = useState(false);
  const [livePacket, setLivePacket] = useState(packet);

  useEffect(() => {
    setLivePacket(withOperatorScenario(packet));
  }, [packet]);

  if (!livePacket) {
    return (
      <div className="p-8 text-center text-slate-500">
        <p>No decision packet data loaded.</p>
      </div>
    );
  }

  const p = livePacket.property || {};
  const u = livePacket.underwriting || {};
  const t = u.titleRisk || {};
  const c = u.cashToClose || {};
  const d = livePacket.dispositionSignOff || {};
  const m = u.macroValuation;
  const municipal = u.municipalSurvivability || {};
  const municipalCount = Number.isFinite(municipal.activeViolationsCount) ? municipal.activeViolationsCount : null;
  const priorityKnown = t.plaintiffType && t.plaintiffType !== 'UNKNOWN';
  const decisionRecorded = d.decision === 'BID' || d.decision === 'PASS' || d.decision === 'UNDERWRITE';

  const handleDownloadJson = () => {
    setDownloading(true);
    const blob = new Blob([JSON.stringify(livePacket, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `decision-packet-${p.id || 'property'}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setDownloading(false);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6 text-slate-900 font-sans print:p-0 print:max-w-none">
      {/* Header bar / Actions */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4 print:hidden">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">Evidentiary Decision Packet</h1>
          <p className="text-xs text-slate-500">Foreclosure due diligence dossier for courthouse auction bidding</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrint}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            <Printer className="w-3.5 h-3.5" />
            Print Dossier
          </button>
          <button
            onClick={handleDownloadJson}
            disabled={downloading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition"
          >
            <Download className="w-3.5 h-3.5" />
            Export JSON
          </button>
        </div>
      </div>

      {/* Packet Provenance Banner */}
      <div className="bg-slate-900 text-slate-200 p-4 rounded-xl space-y-1.5 text-xs font-mono">
        <div className="flex flex-wrap justify-between items-center text-slate-400 text-[11px]">
          <span>PACKET ID: {livePacket.packetId}</span>
          <span>TIMESTAMP: {livePacket.createdAt}</span>
        </div>
        <div className="truncate text-slate-300">
          INTEGRITY CHECKSUM (SHA-256): <span className="text-sky-400 font-bold">{livePacket.integrityChecksum}</span>
        </div>
      </div>

      {/* Property Overview Card */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap justify-between items-start gap-2">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-sky-600 bg-sky-50 px-2 py-0.5 rounded border border-sky-200">
              {p.state} · {p.county}
            </span>
            <h2 className="text-lg font-bold text-slate-950 mt-1">{p.address}</h2>
            <p className="text-xs text-slate-500">{p.city}, {p.state} {p.zip} · {p.propType}</p>
          </div>
          <div className="text-right">
            <span className="text-xs text-slate-500">Opening Bid</span>
            <p className="text-2xl font-black text-slate-950">{moneyOrBlank(p.openingBid, 'Not published')}</p>
            <span className="text-[10px] text-slate-500">{p.caseNumber ? `Case #${p.caseNumber}` : "Case not published"}</span>
          </div>
        </div>
      </div>

      {/* Underwriting Grids */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Title Risk Matrix */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
            <Scale className="w-4 h-4 text-amber-600" />
            <h3 className="font-bold text-sm text-slate-900">Statutory Title Risk</h3>
          </div>
          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-slate-50">
              <span className="text-slate-500">Foreclosing Party:</span>
              <span className="font-semibold">{t.plaintiffType}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-50">
              <span className="text-slate-500">Senior 1st Mortgage:</span>
              <span className={priorityKnown && t.firstMortgageSurvives ? "text-rose-600 font-bold" : "font-semibold text-slate-800"}>
                {priorityKnown ? (t.firstMortgageSurvives ? "SURVIVES FORECLOSURE" : "No senior-lien flag in the published plaintiff text") : "Not established"}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-50">
              <span className="text-slate-500">IRS Tax Lien (26 U.S.C. § 7425):</span>
              <span className="font-semibold">{t.hasIrsTaxLien ? `Phrase in the supplied record (${t.irsRedemptionDays}d)` : "No IRS phrase in the supplied record"}</span>
            </div>
            {Number.isFinite(t.statutoryRedemptionDays) ? (
              <div className="flex justify-between py-1 border-b border-slate-50" data-testid="recorded-redemption">
                <span className="text-slate-500">Recorded redemption:</span>
                <span className="font-semibold">{t.statutoryRedemptionDays} days</span>
              </div>
            ) : null}
          </div>
          {t.alerts && t.alerts.length > 0 && (
            <div className="mt-3 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900 space-y-1">
              {t.alerts.map((alert: any, i: number) => (
                <div key={i} className="flex items-start gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-700 shrink-0 mt-0.5" />
                  <span><strong>{alert.title}:</strong> {alert.description}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Cash to Close Schedule */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-2">
            <DollarSign className="w-4 h-4 text-emerald-600" />
            <h3 className="font-bold text-sm text-slate-900">Cash requirement</h3>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-500">No fee is inferred from the source or the state. Blank lines were not entered. Registration funds are not added again.</p>
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
              <div key={String(label)} className="flex justify-between gap-3 py-1 border-b border-slate-50">
                <span className="text-slate-500">{label}:</span>
                <span className="font-semibold">{moneyOrBlank(value)}</span>
              </div>
            ))}
            <div className="flex justify-between gap-3 py-1 border-b border-slate-50">
              <span className="text-slate-500">Acquisition cost:</span>
              <span className="font-semibold">{moneyOrBlank(c.totalAcquisitionCost)}</span>
            </div>
            <div className="flex justify-between gap-3 pt-2 border-t border-slate-200 font-bold text-sm">
              <span>Cash to close:</span>
              <span className="text-slate-950">{moneyOrBlank(c.cashDueAtSettlement, "Blank until registration funds and the credited deposit are both entered")}</span>
            </div>
          </div>
        </div>
      </div>

      {municipalCount !== null && municipalCount > 0 && (
        <div className="bg-white border border-rose-200 rounded-xl p-5 shadow-sm space-y-2" data-testid="municipal-violations">
          <h3 className="font-bold text-sm text-slate-900">Supplied municipal violations: {municipalCount}</h3>
          {Array.isArray(municipal.criticalAlerts) && municipal.criticalAlerts.map((alert: string) => (
            <p key={alert} className="text-xs leading-relaxed text-slate-700">{alert}</p>
          ))}
        </div>
      )}

      {/* Valuation Benchmark Banner */}
      {m && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs space-y-1">
          <div className="flex justify-between items-center font-semibold text-slate-800">
            <span>Valuation band: ${m.estLow.toLocaleString()} – ${m.estHigh.toLocaleString()}</span>
            <span className="text-[10px] uppercase font-bold text-slate-500 bg-slate-200 px-2 py-0.5 rounded">Macro Benchmark</span>
          </div>
          <p className="text-[11px] text-slate-500 leading-snug">{m.disclaimer}</p>
        </div>
      )}

      {/* Sign-Off Block */}
      <div className="bg-slate-900 text-white p-5 rounded-xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {decisionRecorded ? <CheckCircle2 className="w-5 h-5 text-emerald-400" /> : <FileText className="w-5 h-5 text-slate-400" />}
            <h4 className="font-bold text-sm">Operator disposition: {decisionRecorded ? d.decision : "Not recorded"}</h4>
          </div>
          {typeof d.maxAllowableOffer === "number" && (
            <span className="text-xs font-mono text-emerald-300">MAO: ${d.maxAllowableOffer.toLocaleString()}</span>
          )}
        </div>
        <p className="text-xs text-slate-300 italic border-l-2 border-slate-700 pl-3">
          "{d.operatorNotes || "No operator commentary recorded."}"
        </p>
        <div className="flex justify-between text-[10px] text-slate-400 pt-2 border-t border-slate-800">
          <span>Operator: {d.operatorId || "Not recorded"}</span>
          <span>{d.signedAt || "Not signed"}</span>
        </div>
      </div>
    </div>
  );
}

export default DecisionPacketView;
