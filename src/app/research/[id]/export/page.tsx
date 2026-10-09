import type { Metadata } from 'next';
import { WorkspaceShell } from '@/components/workspace/workspace-shell';
import { DecisionPacketView } from '@/components/research/decision-packet-view';

export const metadata: Metadata = {
  title: 'Foreclosure Decision Packet | PerfectProperty',
  description: 'Auditable due diligence decision packet with title risk matrix and cash-to-close schedule'
};

export default async function DecisionPacketExportPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // In App Router SSR, construct packet shape
  const samplePacket = {
    packetId: `DP-${id}`,
    schemaVersion: 'decision-packet/v1',
    createdAt: new Date().toISOString(),
    integrityChecksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    property: {
      id,
      address: 'Foreclosure Dossier Target',
      city: 'County Seat',
      state: 'OH',
      county: 'Cuyahoga',
      zip: '44113',
      propType: 'Single Family',
      caseNumber: 'CV-24-998812',
      openingBid: 65000
    },
    underwriting: {
      titleRisk: {
        plaintiffType: '1st Mortgage Lender',
        riskLevel: 'LOW',
        canProceedWithBid: true,
        firstMortgageSurvives: false,
        hasIrsTaxLien: false,
        statutoryRedemptionDays: 0,
        alerts: []
      },
      cashToClose: {
        totalAcquisitionCost: 68250,
        buyersPremium: 0,
        sheriffPoundage: 1950,
        transferTax: 260,
        recordingFees: 150,
        creditedDeposit: 5000,
        netCashDueAtSettlement: 63250
      },
      macroValuation: {
        estimatedMacroValue: 125000,
        estLow: 115000,
        estHigh: 135000,
        disclaimer: 'Derived from FHFA House Price Index data. Not a certified appraisal.'
      }
    },
    dispositionSignOff: {
      decision: 'UNDERWRITE',
      maxAllowableOffer: 80000,
      operatorNotes: 'Clean 1st lien judicial foreclosure. Confirm occupancy before bidding.',
      operatorId: 'operator-lead',
      signedAt: new Date().toISOString()
    }
  };

  return (
    <WorkspaceShell>
      <main className="min-h-screen bg-slate-50 py-8">
        <DecisionPacketView packet={samplePacket} />
      </main>
    </WorkspaceShell>
  );
}
