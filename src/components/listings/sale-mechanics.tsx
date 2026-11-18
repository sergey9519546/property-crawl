import { CalendarClock, FileText, GitCompareArrows, ShieldCheck } from "lucide-react";
import type { PropertyListing } from "@/components/terminal/property-data";
import { displayDate, displayText } from "@/lib/listing-display";
import { sourceDisplayText } from "@/lib/source-display";
import type { Messages } from "@/lib/i18n/messages/en";
import type { Locale } from "@/lib/i18n/config";
import { formatLocaleDate, formatUsd, interpolate } from "@/lib/i18n/translator";

function optionalText(raw: unknown): string | null {
  const rendered = displayText(raw, "");
  return rendered || null;
}

function formatMoney(amount: number, locale: Locale = "en"): string {
  return locale === "en" ? `$${Math.round(amount).toLocaleString("en-US")}` : formatUsd(locale, amount);
}

function publishedBoolean(raw: unknown, yesLabel = "Yes", noLabel = "No"): string | null {
  return typeof raw === "boolean" ? (raw ? yesLabel : noLabel) : null;
}

/** Facts are shown as publisher observations, never as bidding instructions. */
export function SaleMechanics({ listing, exactSourceUrl, labels, locale = "en" }: {
  listing: PropertyListing;
  exactSourceUrl: string | null;
  labels?: Messages["detailUi"];
  locale?: Locale;
}) {
  const provenance = listing.provenance || {};
  const sourceFacts = provenance.sourceFacts && typeof provenance.sourceFacts === "object" ? provenance.sourceFacts as Record<string, unknown> : {};
  const documents = listing.documentEvidence;
  const yes = labels ? labels.yesLabel : "Yes";
  const no = labels ? labels.noLabel : "No";
  const docCount = documents?.count;
  const docsValue = docCount != null
    ? (labels
        ? interpolate(docCount === 1 ? labels.smRefsCapturedSingle : labels.smRefsCapturedPlural, { count: docCount })
        : `${docCount} reference${docCount === 1 ? "" : "s"} captured`)
    : null;
  const publishedUpsetAmount = Number((provenance.approximateUpsetPrice as { amount?: unknown } | null | undefined)?.amount ?? sourceFacts.upsetPrice);
  const factCandidates: [string, unknown][] = [
    [labels ? labels.smProgram : "Program", listing.auctionProgram || listing.program],
    [labels ? labels.smAuctionMethod : "Auction method", sourceFacts.auctionMethod],
    [labels ? labels.smCashOnly : "Cash-only requirement", publishedBoolean(sourceFacts.isCashOnly, yes, no)],
    [labels ? labels.smFinancing : "Financing available", publishedBoolean(sourceFacts.isFinancible, yes, no)],
    [labels ? labels.smInteriorAccess : "Interior access available", publishedBoolean(sourceFacts.interiorAccessAvailable, yes, no)],
    [labels ? labels.smClearedForSale : "Cleared for sale", sourceFacts.clearedForSale],
    [labels ? labels.smDepositTerms : "Deposit / payment terms", listing.deposit],
    ["Approximate upset price", Number.isFinite(publishedUpsetAmount) && publishedUpsetAmount > 0 ? `${formatMoney(publishedUpsetAmount, locale)} (qualified estimate)` : null],
    [labels ? labels.smExecJudgment : "Execution judgment", listing.judgment && Number(listing.judgment) > 0 ? formatMoney(Number(listing.judgment), locale) : null],
    [labels ? labels.smOpeningTiming : "Opening bid timing", listing.openingBid == null && listing.judgment && Number(listing.judgment) > 0 ? (labels ? labels.smAnnouncedMorning : "Announced morning of sale (upset price pending)") : null],
    [labels ? labels.smPublisherDocs : "Publisher documents", docsValue],
  ];
  const facts = factCandidates.flatMap(([label, raw]) => {
    const rendered = optionalText(raw);
    return rendered ? [[label, rendered] as const] : [];
  });
  const moneyGaps = [
    listing.openingBid == null ? (labels ? labels.smGapOpening : "opening amount") : null,
    !optionalText(listing.deposit) ? (labels ? labels.smGapDeposit : "deposit or payment terms") : null,
  ].filter(Boolean);
  const accessGap = /occupied/i.test(optionalText(listing.occupancy) || "") && publishedBoolean(sourceFacts.interiorAccessAvailable) === null;
  const events = [
    [labels ? labels.smEvObserved : "Publisher record observed", listing.sourceObservedAt || provenance.observedAt],
    [labels ? labels.smEvUpdated : "Publisher update captured", listing.fetchedAt || (provenance as Record<string, unknown>).updatedAt],
  ] as const;

  return <section id="auction-details" className="mt-8 scroll-mt-6 rounded-card border border-line bg-card p-5 shadow-sm sm:p-6" aria-labelledby="sale-mechanics-heading">
    <div className="flex items-start gap-3"><CalendarClock className="mt-0.5 h-5 w-5 shrink-0 text-ink-3" /><div><p className="text-label font-bold uppercase tracking-[.16em] text-ink-3">{labels ? labels.saleMechanicsEyebrow : "Publisher-reported auction terms"}</p><h2 id="sale-mechanics-heading" className="mt-1 text-xl font-bold">{labels ? labels.saleMechanicsHeading : "What affects the sale"}</h2><p className="mt-1 text-sm leading-relaxed text-ink-3">{labels ? labels.saleMechanicsSub : "Review timing, location, access, and funds requirements before attending."}</p></div></div>
    {facts.length ? <dl className="mt-5 grid gap-x-8 gap-y-4 text-sm sm:grid-cols-2">{facts.map(([label, rendered]) => <Fact key={label} label={label} value={rendered} />)}</dl> : <p className="mt-5 rounded-control bg-catch-wash p-4 text-sm text-catch-ink">{labels ? labels.noAdditionalSaleTerms : "No additional auction terms were supplied in the normalized publisher record."}</p>}
    {moneyGaps.length || accessGap ? <p className="mt-5 rounded-control border border-catch/30 bg-catch-wash px-4 py-3 text-sm leading-relaxed text-catch-ink"><strong>{labels ? labels.stillUnconfirmedLabel : "Still unconfirmed:"}</strong> {[...moneyGaps, accessGap ? (labels ? labels.smGapInterior : "interior access terms") : null].filter(Boolean).join(", ")}. {labels ? labels.stillUnconfirmedSuffix : "Verify these items at the exact publisher listing."}</p> : null}
    <details className="mt-5 border-t border-line pt-4">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-bold text-ink"><ShieldCheck size={15} />{labels ? labels.evidenceTimingSummary : "Evidence timing and source verification"}</summary>
      <div className="pt-4"><p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-ink-3"><GitCompareArrows size={14} />{labels ? labels.evidenceTimelineLabel : "Evidence timeline"}</p><ol className="mt-3 space-y-3">{events.map(([label, date]) => <li key={label} className="flex gap-3 text-xs"><span className="mt-1 h-2.5 w-2.5 rounded-full bg-ink" /><div><strong>{label}</strong><p className="mt-0.5 text-ink-3">{typeof date === "string" ? (locale === "en" ? displayDate(date, date) : formatLocaleDate(locale, date)) : (labels ? labels.notEstablished : "Not established")}</p></div></li>)}</ol>
      {exactSourceUrl ? <a href={exactSourceUrl} target="_blank" rel="noreferrer" className="mt-5 inline-flex items-center gap-2 text-xs font-bold text-ink underline hover:text-ink-2"><FileText size={14} />{labels ? labels.openExactPublisherRecord : "Open the exact publisher record"}</a> : <p className="mt-5 text-xs text-catch-ink">{labels ? labels.exactPublisherMissingWarning : "An exact publisher record has not been captured, so the sale terms need source verification."}</p>}</div>
    </details>
  </section>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="border-b border-line pb-3"><dt className="text-xs text-ink-3">{label}</dt><dd className="mt-1 font-semibold text-ink">{sourceDisplayText(value)}</dd></div>;
}
