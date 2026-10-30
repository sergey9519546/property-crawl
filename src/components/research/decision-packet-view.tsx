'use client';

import { useEffect, useState } from 'react';
import { Download, Printer, ShieldAlert, CheckCircle2, DollarSign, Scale, FileText, Clock, Calendar, Building } from 'lucide-react';
import { computeCashToClose, computeLienWaterfall, computeStatutoryDeadlinesAndCarry } from '@/lib/underwriting';
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
  const bidAmount = typeof p.openingBid === 'number' && p.openingBid > 0 ? p.openingBid : 0;
  // A surviving first mortgage has no published balance, so the waterfall is only
  // computed when nothing senior survives; otherwise we say the amount is unknown.
  const seniorBalanceUnknown = Boolean(t.firstMortgageSurvives);
  const waterfall = bidAmount > 0 && !seniorBalanceUnknown
    ? computeLienWaterfall({
        winningBid: bidAmount,
        foreclosingLienType: t.firstMortgageSurvives ? "second_mortgage" : "first_mortgage",
        foreclosingLienAmount: bidAmount,
        seniorMortgageAmount: 0,
        delinquentTaxesAmount: typeof c.delinquentTaxes === 'number' ? c.delinquentTaxes : 0,
        state: p.state,
      })
    : null;

  const deadlines = u.statutoryDeadlinesAndCarry || computeStatutoryDeadlinesAndCarry({
    saleDate: p.saleDate,
    state: p.state,
    purchasePrice: p.openingBid,
    redemptionDays: t.statutoryRedemptionDays,
    hasIrsLien: Boolean(t.hasIrsTaxLien)
  });

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

      {/* Statutory Deadlines & Capital Holding Carry */}
      {deadlines && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3" data-testid="statutory-deadlines-carry">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-indigo-600" />
              <h3 className="font-bold text-sm text-slate-900">Statutory Deadlines & Capital Holding Carry</h3>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
              Lockup: {deadlines.effectiveLockupDays} Days
            </span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="space-y-2">
              <div className="flex justify-between py-1 border-b border-slate-50">
                <span className="text-slate-500">Objection / Confirmation:</span>
                <span className="font-semibold text-right max-w-[240px]">
                  {deadlines.objectionLabel || `${deadlines.objectionOrConfirmationDays} days`}
                  {deadlines.objectionDeadline ? ` (${deadlines.objectionDeadline})` : ''}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-50">
                <span className="text-slate-500">IRS 120-Day Right (26 U.S.C. § 7425):</span>
                <span className="font-semibold">
                  {deadlines.irsRedemptionDays > 0
                    ? `${deadlines.irsRedemptionDays} days (${deadlines.irsRedemptionDeadline || 'pending'})`
                    : 'None (no IRS lien)'}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-50">
                <span className="text-slate-500">State Statutory Redemption:</span>
                <span className="font-semibold">
                  {deadlines.stateRedemptionDays > 0
                    ? `${deadlines.stateRedemptionDays} days (${deadlines.stateRedemptionDeadline || 'pending'})`
                    : (t.statutoryRedemptionDays === null ? 'Not published' : '0 days')}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-50">
                <span className="text-slate-500 font-medium">Effective Capital Lockup:</span>
                <span className="font-bold text-indigo-900">{deadlines.effectiveLockupDays} days</span>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between py-1 border-b border-slate-50">
                <span className="text-slate-500">Cost of Capital Rate:</span>
                <span className="font-semibold">{deadlines.annualCostOfCapitalPct}% annual</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-50">
                <span className="text-slate-500">Monthly Holding Carry:</span>
                <span className="font-semibold">{moneyOrBlank(deadlines.monthlyHoldingCost, 'Requires buyer-supplied price')}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-50">
                <span className="text-slate-500">Property Tax Carry ({deadlines.effectiveTaxRatePct}%):</span>
                <span className="font-semibold">{moneyOrBlank(deadlines.estimatedPropertyTaxCarry, 'Requires buyer-supplied price')}</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-50">
                <span className="text-slate-500">Insurance Carry:</span>
                <span className="font-semibold">{moneyOrBlank(deadlines.estimatedInsuranceCarry, 'Requires buyer-supplied price')}</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-slate-200 font-bold">
                <span className="text-slate-900">Total Holding Cost Carry:</span>
                <span className="text-indigo-950 font-black">{moneyOrBlank(deadlines.totalHoldingCostCarry, 'Requires buyer-supplied price')}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Lien Priority & Waterfall Schedule */}
      {seniorBalanceUnknown && bidAmount > 0 && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-900" data-testid="lien-waterfall-unknown">
          <strong>A first mortgage may survive this sale, and its balance is not published.</strong> The lien waterfall is not computed. Pull the recorded mortgage and payoff before bidding.
        </div>
      )}
      {waterfall && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3" data-testid="lien-waterfall-schedule">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
            <div className="flex items-center gap-2">
              <Scale className="w-4 h-4 text-slate-800" />
              <h3 className="font-bold text-sm text-slate-900">Lien Priority & Debt Extinguishment Waterfall</h3>
            </div>
            <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${waterfall.totalSurvivingDebtOnProperty > 0 ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'}`}>
              {waterfall.totalSurvivingDebtOnProperty > 0 ? `Surviving Senior Debt: $${waterfall.totalSurvivingDebtOnProperty.toLocaleString()}` : 'Zero Surviving Liens'}
            </span>
          </div>

          {waterfall.criticalAlert && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-950 font-medium">
              {waterfall.criticalAlert}
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-1.5 pr-2 font-semibold">Priority</th>
                  <th className="py-1.5 pr-2 font-semibold">Instrument / Lienholder</th>
                  <th className="py-1.5 pr-2 text-right font-semibold">Claim Amount</th>
                  <th className="py-1.5 pr-2 text-right font-semibold">Paid From Bid</th>
                  <th className="py-1.5 text-right font-semibold">Title Status on Property</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {waterfall.items.map((item) => (
                  <tr key={item.id} className="text-slate-800">
                    <td className="py-1.5 pr-2 font-bold text-slate-600">#{item.seniority}</td>
                    <td className="py-1.5 pr-2 font-semibold text-slate-900">
                      {item.name}
                      {item.isForeclosingLien && (
                        <span className="ml-1.5 rounded bg-indigo-100 px-1 py-0.2 text-[9px] font-bold text-indigo-800">
                          Foreclosing
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-2 text-right">${item.amount.toLocaleString()}</td>
                    <td className="py-1.5 pr-2 text-right text-emerald-700 font-semibold">${item.amountPaidFromProceeds.toLocaleString()}</td>
                    <td className={`py-1.5 text-right font-bold ${item.remainingBalanceAgainstProperty > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                      {item.remainingBalanceAgainstProperty > 0 ? `SURVIVES ($${item.remainingBalanceAgainstProperty.toLocaleString()})` : 'EXTINGUISHED'}
                    </td>
                  </tr>
                ))}
                {waterfall.surplusProceedsToBorrower > 0 && (
                  <tr className="bg-sky-50/60 font-semibold text-sky-950">
                    <td className="py-1.5 pr-2 text-[10px] uppercase font-bold text-sky-800">Surplus</td>
                    <td className="py-1.5 pr-2" colSpan={2}>
                      Debtor / Mortgagor Surplus Proceeds
                    </td>
                    <td className="py-1.5 pr-2 text-right text-emerald-700">
                      ${waterfall.surplusProceedsToBorrower.toLocaleString()}
                    </td>
                    <td className="py-1.5 text-right text-slate-400">—</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-600 leading-snug">{waterfall.summary}</p>
        </div>
      )}

      {/* HUD Small Area FMR & Section 8 Voucher Floor */}
      {livePacket.hudSafmr && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm space-y-3" data-testid="hud-safmr-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
            <div className="flex items-center gap-2">
              <Building className="w-4 h-4 text-sky-600" />
              <h3 className="font-bold text-sm text-slate-900">HUD Statutory Fair Market Rent (SAFMR) Floor</h3>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-sky-700 bg-sky-50 px-2 py-0.5 rounded border border-sky-200">
              ZIP {livePacket.hudSafmr.zip} · FY2025 Revised Section 8 FMR
            </span>
          </div>
          <p className="text-[11px] text-slate-500 leading-snug">
            Small Area FMR statutory voucher payment standards under 24 CFR § 888.113. Establishes the non-credit tenant rent floor for Section 8 Housing Choice Vouchers (90% payment floor to 110% payment ceiling).
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-1.5 pr-2 font-semibold">Unit Size</th>
                  <th className="py-1.5 pr-2 text-right font-semibold">Baseline FMR</th>
                  <th className="py-1.5 pr-2 text-right font-semibold">90% Voucher Floor</th>
                  <th className="py-1.5 text-right font-semibold">110% Voucher Ceiling</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium text-slate-800">
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
                      <td className="py-1.5 pr-2 font-semibold text-slate-900">{label}</td>
                      <td className="py-1.5 pr-2 text-right">{typeof base === 'number' ? `$${base.toLocaleString()}` : '—'}</td>
                      <td className="py-1.5 pr-2 text-right text-emerald-700 font-semibold">{typeof floor90 === 'number' ? `$${floor90.toLocaleString()}` : '—'}</td>
                      <td className="py-1.5 text-right font-semibold">{typeof ceil110 === 'number' ? `$${ceil110.toLocaleString()}` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-slate-400 italic">
            Statutory Citation: 42 U.S.C. § 1437f(o)(1)(B); official HUD Small Area Fair Market Rent schedule.
          </p>
        </div>
      )}

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
