import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { WorkspaceShell } from '@/components/workspace/workspace-shell';
import { DecisionPacketView } from '@/components/research/decision-packet-view';
import { hasPermission, readWorkspaceSession, workspaceSessionConfiguration } from '@/lib/workspace-session';
import { buildDecisionPacket } from '@server/export/decision-packet';
import { getMessages } from '@/lib/i18n/messages';
import { getRequestLocale } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  const t = getMessages(locale).metaExtra;
  return {
    title: t.decisionPacketTitle || 'Foreclosure Decision Packet | PerfectProperty',
    description: t.decisionPacketDesc,
    robots: { index: false, follow: false },
  };
}

async function fetchListingOrCase(id: string) {
  let decodedId = id;
  try { decodedId = decodeURIComponent(id); } catch { /* retain raw param on malformed escape */ }
  const baseUrl = process.env.PROPERTY_API_URL || 'http://localhost:3000';

  let listing: any = null;
  let caseDecision: any = null;

  // 1. Try to fetch as direct listing ID
  try {
    const res = await fetch(`${baseUrl}/api/listings/${encodeURIComponent(decodedId)}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(12_000),
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

  // 2. If listing was found, check if an authenticated operator has an active research case for this listing
  if (listing) {
    try {
      const incomingHeaders = await headers();
      const cookieHeader = incomingHeaders.get('cookie') || '';
      const sessionRequest = new Request(`${baseUrl}/research/${encodeURIComponent(decodedId)}/export`, {
        headers: cookieHeader ? { cookie: cookieHeader } : undefined,
      });
      const configuration = workspaceSessionConfiguration();
      const session = readWorkspaceSession(sessionRequest);
      if (configuration.configured && session.authenticated && hasPermission(session.role, 'canExportDossier')) {
        const caseListRes = await fetch(`${baseUrl}/api/workspace/cases?listingId=${encodeURIComponent(listing.id)}`, {
          cache: 'no-store',
          headers: { 'x-scraper-token': configuration.credential },
          signal: AbortSignal.timeout(12_000),
        });
        if (caseListRes.ok) {
          const caseListData = await caseListRes.json();
          const firstCase = Array.isArray(caseListData?.items) ? caseListData.items[0] : null;
          if (firstCase?.id) {
            const caseDetailRes = await fetch(`${baseUrl}/api/workspace/cases/${encodeURIComponent(firstCase.id)}`, {
              cache: 'no-store',
              headers: { 'x-scraper-token': configuration.credential },
              signal: AbortSignal.timeout(12_000),
            });
            if (caseDetailRes.ok) {
              const caseDetailData = await caseDetailRes.json();
              if (caseDetailData?.case) {
                caseDecision = caseDetailData.case;
              }
            }
          }
        }
      }
    } catch {
      // Ignore
    }
  }

  // 3. If not found directly, try fetching as research case ID (gated on authenticated workspace session)
  if (!listing) {
    try {
      const incomingHeaders = await headers();
      const cookieHeader = incomingHeaders.get('cookie') || '';
      const sessionRequest = new Request(`${baseUrl}/research/${encodeURIComponent(decodedId)}/export`, {
        headers: cookieHeader ? { cookie: cookieHeader } : undefined,
      });
      const configuration = workspaceSessionConfiguration();
      const session = readWorkspaceSession(sessionRequest);
      if (configuration.configured && session.authenticated && hasPermission(session.role, 'canExportDossier')) {
        const caseRes = await fetch(`${baseUrl}/api/workspace/cases/${encodeURIComponent(decodedId)}`, {
          cache: 'no-store',
          headers: { 'x-scraper-token': configuration.credential },
          signal: AbortSignal.timeout(12_000),
        });
        if (caseRes.ok) {
          const caseData = await caseRes.json();
          if (caseData?.case?.listingId) {
            caseDecision = caseData.case;
            // Now fetch the listing for this case
            const res = await fetch(`${baseUrl}/api/listings/${encodeURIComponent(caseData.case.listingId)}`, {
              cache: 'no-store',
              signal: AbortSignal.timeout(12_000),
            });
            if (res.ok) {
              const data = await res.json();
              if (data && typeof data === 'object' && !('error' in data)) {
                listing = data;
              }
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
  const { listing, caseDecision } = await fetchListingOrCase(id);

  if (!listing) {
    notFound();
  }

  const scenario = caseDecision?.underwriteScenario || null;

  const positiveNum = (val: unknown): number | undefined => {
    if (val === null || val === undefined || val === '') return undefined;
    const n = Number(val);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const operatorInput: {
    disposition?: string;
    operatorNotes?: string;
    operatorId?: string;
    maxAllowableOffer?: number;
    rehabBudget?: number;
    targetMargin?: number;
    customValuation?: number;
    customOpeningBid?: number;
    holdingMonths?: number;
    isHomestead?: boolean;
    registrationFunds?: number;
    creditedDeposit?: number;
    buyersPremium?: number;
    sheriffPoundage?: number;
    transferTax?: number;
    delinquentTaxes?: number;
    settlementCosts?: number;
  } = {
    maxAllowableOffer: caseDecision?.decision?.maxOffer ?? scenario?.maxAllowableOffer ?? undefined,
    rehabBudget: scenario?.rehabBudget ?? undefined,
    targetMargin: scenario?.targetMargin ?? undefined,
    customValuation: positiveNum(scenario?.customValuation),
    customOpeningBid: positiveNum(scenario?.customOpeningBid),
    holdingMonths: typeof scenario?.holdingMonths === 'number' && Number.isFinite(scenario.holdingMonths) && scenario.holdingMonths > 0
      ? scenario.holdingMonths
      : undefined,
    isHomestead: typeof scenario?.isHomestead === 'boolean' ? scenario.isHomestead : undefined,
  };

  if (caseDecision?.state === 'pursue') operatorInput.disposition = 'BID';
  else if (caseDecision?.state === 'pass') operatorInput.disposition = 'PASS';
  if (typeof caseDecision?.decision?.note === 'string' && caseDecision.decision.note.trim()) {
    operatorInput.operatorNotes = caseDecision.decision.note;
  }
  if (caseDecision?.decision?.reviewer) operatorInput.operatorId = caseDecision.decision.reviewer;

  const cashFields = [
    'registrationFunds',
    'creditedDeposit',
    'buyersPremium',
    'sheriffPoundage',
    'transferTax',
    'delinquentTaxes',
    'settlementCosts',
  ] as const;

  if (scenario) {
    for (const field of cashFields) {
      const raw = scenario[field];
      if (raw !== undefined && raw !== null && raw !== '') {
        const num = Number(raw);
        if (Number.isFinite(num) && num >= 0) {
          operatorInput[field] = num;
        }
      }
    }
  }

  const decisionPacket = buildDecisionPacket(listing, operatorInput);

  return (
    <WorkspaceShell>
      <main id="main-content" tabIndex={-1} className="min-h-screen bg-paper py-8 outline-none">
        <DecisionPacketView packet={decisionPacket} />
      </main>
    </WorkspaceShell>
  );
}
