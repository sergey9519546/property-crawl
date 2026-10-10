import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, AlertCircle } from 'lucide-react';
import { WorkspaceShell } from '@/components/workspace/workspace-shell';
import { DecisionPacketView } from '@/components/research/decision-packet-view';
import { buildDecisionPacket } from '@server/export/decision-packet';

export const metadata: Metadata = {
  title: 'Foreclosure Decision Packet | PerfectProperty',
  description: 'Auditable due diligence decision packet with title risk matrix and cash-to-close schedule'
};

async function fetchListingOrCase(id: string) {
  const decodedId = decodeURIComponent(id);
  const baseUrl = process.env.PROPERTY_API_URL || 'http://localhost:3000';

  let listing: any = null;
  let caseDecision: any = null;

  // 1. Try to fetch as direct listing ID
  try {
    const res = await fetch(`${baseUrl}/api/listings/${encodeURIComponent(decodedId)}`, {
      cache: 'no-store'
    });
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data === 'object' && !('error' in data)) {
        listing = data;
      }
    }
  } catch {
    // API down or network issue
  }

  // 2. If not found, try fetching as research case ID
  if (!listing) {
    try {
      const caseRes = await fetch(`${baseUrl}/api/workspace/cases/${encodeURIComponent(decodedId)}`, {
        cache: 'no-store'
      });
      if (caseRes.ok) {
        const caseData = await caseRes.json();
        if (caseData?.case?.listingId) {
          caseDecision = caseData.case;
          // Now fetch the listing for this case
          const res = await fetch(`${baseUrl}/api/listings/${encodeURIComponent(caseData.case.listingId)}`, {
            cache: 'no-store'
          });
          if (res.ok) {
            const data = await res.json();
            if (data && typeof data === 'object' && !('error' in data)) {
              listing = data;
            }
          }
        }
      }
    } catch {
      // Ignore
    }
  }

  return { listing, caseDecision, decodedId };
}

export default async function DecisionPacketExportPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { listing, caseDecision, decodedId } = await fetchListingOrCase(id);

  if (!listing) {
    return (
      <WorkspaceShell>
        <main className="min-h-screen bg-slate-50 py-12 px-6">
          <div className="max-w-2xl mx-auto rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <AlertCircle className="mx-auto h-10 w-10 text-amber-600" />
            <h1 className="mt-4 text-xl font-bold text-slate-900">Listing Record Not Found</h1>
            <p className="mt-2 text-sm text-slate-600 leading-relaxed">
              No active or verified source record could be found for identifier{' '}
              <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded text-xs text-slate-800">{decodedId}</code>.
              Decision packets can only be generated from verified property records.
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <Link
                href="/listings"
                className="inline-flex items-center gap-2 rounded-xl bg-[#0F172A] px-5 py-2.5 text-xs font-bold text-white hover:bg-slate-800 transition"
              >
                <ArrowLeft className="h-4 w-4" />
                Return to listings
              </Link>
            </div>
          </div>
        </main>
      </WorkspaceShell>
    );
  }

  // Construct real decision packet using underwriting and cash-to-close engines
  const operatorInput = {
    disposition: caseDecision?.state === 'pursue' ? 'BID' : caseDecision?.state === 'pass' ? 'PASS' : 'UNDERWRITE',
    operatorNotes: caseDecision?.decision?.note || 'Evidentiary export generated for courthouse due diligence.',
    operatorId: caseDecision?.decision?.reviewer || 'operator-current',
    maxAllowableOffer: caseDecision?.decision?.maxOffer || undefined
  };

  const decisionPacket = buildDecisionPacket(listing, operatorInput);

  return (
    <WorkspaceShell>
      <main className="min-h-screen bg-slate-50 py-8">
        <DecisionPacketView packet={decisionPacket} />
      </main>
    </WorkspaceShell>
  );
}
