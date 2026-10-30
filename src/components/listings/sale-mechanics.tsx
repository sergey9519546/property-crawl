import { CalendarClock, FileText, GitCompareArrows, ShieldCheck } from "lucide-react";
import type { PropertyListing } from "@/components/terminal/property-data";
import { displayDate, displayText } from "@/lib/listing-display";
import { sourceDisplayText } from "@/lib/source-display";

function optionalText(raw: unknown): string | null {
  const rendered = displayText(raw, "");
  return rendered || null;
}

function publishedBoolean(raw: unknown): string | null {
  return typeof raw === "boolean" ? (raw ? "Yes" : "No") : null;
}

/** Facts are shown as publisher observations, never as bidding instructions. */
export function SaleMechanics({ listing, exactSourceUrl }: { listing: PropertyListing; exactSourceUrl: string | null }) {
  const provenance = listing.provenance || {};
  const sourceFacts = provenance.sourceFacts && typeof provenance.sourceFacts === "object" ? provenance.sourceFacts as Record<string, unknown> : {};
  const documents = listing.documentEvidence;
  const factCandidates: [string, unknown][] = [
    ["Program", listing.auctionProgram || listing.program],
    ["Auction method", sourceFacts.auctionMethod],
    ["Cash-only requirement", publishedBoolean(sourceFacts.isCashOnly)],
    ["Financing available", publishedBoolean(sourceFacts.isFinancible)],
    ["Interior access available", publishedBoolean(sourceFacts.interiorAccessAvailable)],
    ["Cleared for sale", sourceFacts.clearedForSale],
    ["Deposit / payment terms", listing.deposit],
    ["Publisher documents", documents?.count != null ? `${documents.count} reference${documents.count === 1 ? "" : "s"} captured` : null],
  ];
  const facts = factCandidates.flatMap(([label, raw]) => {
    const rendered = optionalText(raw);
    return rendered ? [[label, rendered] as const] : [];
  });
  const moneyGaps = [listing.openingBid == null ? "opening amount" : null, !optionalText(listing.deposit) ? "deposit or payment terms" : null].filter(Boolean);
  const accessGap = /occupied/i.test(optionalText(listing.occupancy) || "") && publishedBoolean(sourceFacts.interiorAccessAvailable) === null;
  const events = [
    ["Publisher record observed", listing.sourceObservedAt || provenance.observedAt],
    ["Publisher update captured", listing.fetchedAt || (provenance as Record<string, unknown>).updatedAt],
  ] as const;

  return <section id="auction-details" className="mt-8 scroll-mt-6 rounded-2xl border border-line bg-card p-5 shadow-sm sm:p-6" aria-labelledby="sale-mechanics-heading">
    <div className="flex items-start gap-3"><CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-ink-3" /><div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-ink-3">Publisher-reported auction terms</p><h2 id="sale-mechanics-heading" className="mt-1 text-xl font-bold">What affects the sale</h2><p className="mt-1 text-sm leading-relaxed text-ink-3">Review timing, location, access, and funds requirements before attending.</p></div></div>
    {facts.length ? <dl className="mt-5 grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">{facts.map(([label, rendered]) => <Fact key={label} label={label} value={rendered} />)}</dl> : <p className="mt-5 rounded-xl bg-catch-wash p-4 text-sm text-catch-ink">No additional auction terms were supplied in the normalized publisher record.</p>}
    {moneyGaps.length || accessGap ? <p className="mt-5 rounded-xl border border-catch/30 bg-catch-wash px-4 py-3 text-sm leading-relaxed text-catch-ink"><strong>Still unconfirmed:</strong> {[...moneyGaps, accessGap ? "interior access terms" : null].filter(Boolean).join(", ")}. Verify these items at the exact publisher listing.</p> : null}
    <details className="mt-5 border-t border-line pt-4">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-bold text-ink"><ShieldCheck size={15} />Evidence timing and source verification</summary>
      <div className="pt-4"><p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-ink-3"><GitCompareArrows size={14} />Evidence timeline</p><ol className="mt-3 space-y-3">{events.map(([label, date]) => <li key={label} className="flex gap-3 text-xs"><span className="mt-1 h-2.5 w-2.5 rounded-full bg-ink" /><div><strong>{label}</strong><p className="mt-0.5 text-ink-3">{typeof date === "string" ? displayDate(date, date) : "Not established"}</p></div></li>)}</ol>
      {exactSourceUrl ? <a href={exactSourceUrl} target="_blank" rel="noreferrer" className="mt-5 inline-flex items-center gap-2 text-xs font-bold text-ink underline hover:text-ink-2"><FileText size={14} />Open the exact publisher record</a> : <p className="mt-5 text-xs text-catch-ink">An exact publisher record has not been captured, so the sale terms need source verification.</p>}</div>
    </details>
  </section>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="border-b border-line pb-3"><dt className="text-xs text-ink-3">{label}</dt><dd className="mt-1 font-semibold text-ink">{sourceDisplayText(value)}</dd></div>;
}
