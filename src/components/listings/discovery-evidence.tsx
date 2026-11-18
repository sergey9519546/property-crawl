"use client";

import Link from 'next/link';
import { useWorkspaceSession } from '@/components/workspace/workspace-shell';
import { PropertyDocuments } from '@/components/listings/property-documents';
import type { DocumentEvidence } from '@/lib/document-evidence';
import { useLocale } from "@/components/i18n/locale-provider";
import { LOCALE_META } from "@/lib/i18n/config";
import { formatLocaleDate } from "@/lib/i18n/translator";

export type DiscoveryEvidenceData = {
  documentEvidence?: DocumentEvidence;
  evidenceTimeline?: { total: number; truncated: boolean; items: { snapshotId: string; observedAt: string; origin: string; kind: string; payloadSha256: string; evidenceUrl: string }[] };
  linkedPublisherRecords?: { id: string; source: string; parcelId: string; jurisdiction: string; observedAt: string; sourceUrl: string }[];
  identityCandidates?: { id: string; source: string; address: string }[];
  publisherConflicts?: { field: string; listingValue: unknown; publisherValue: unknown; listingId: string; source: string }[];
  mediaEvidence?: { references: unknown[]; assets: { sha256: string; displayStatus: string; rights: string }[]; documents: Record<string, unknown>[] | null };
  saleMechanics?: { scheduledTime: string | null; timeZone: string | null; windowStart: string | null; windowEnd: string | null; location: string | null; method: string | null };
};

export function DiscoveryEvidence({ evidence, documentsShown = false }: { evidence: DiscoveryEvidenceData; documentsShown?: boolean }) {
  const { locale, messages, format } = useLocale();
  const t = messages.mediaUi;
  const session = useWorkspaceSession();
  const readable = (value: unknown) => value === null || value === undefined ? t.notSupplied : String(value);
  const date = (value: string) => formatLocaleDate(locale, value, { dateStyle: "medium", timeStyle: "short" });
  const { evidenceTimeline: timeline, mediaEvidence: media, saleMechanics: sale } = evidence;
  return <div className="space-y-5 text-xs">
    {sale && <details className="border-b border-line pb-4"><summary className="cursor-pointer text-sm font-semibold text-ink-2">{t.saleTimingSummary}</summary><dl className="mt-3 grid gap-3 sm:grid-cols-2">
      <div><dt className="text-ink-3">{t.suppliedTimeZone}</dt><dd>{readable(sale.scheduledTime)} / {readable(sale.timeZone)}</dd></div>
      <div><dt className="text-ink-3">{t.auctionMethod}</dt><dd>{readable(sale.method)}</dd></div>
      <div><dt className="text-ink-3">{t.publisherWindow}</dt><dd>{readable(sale.windowStart)} → {readable(sale.windowEnd)}</dd></div>
      <div><dt className="text-ink-3">{t.saleLocation}</dt><dd>{readable(sale.location)}</dd></div>
    </dl></details>}
    {!documentsShown && <PropertyDocuments evidence={evidence.documentEvidence} locale={locale} intlLocale={LOCALE_META[locale].intlLocale} labels={messages.detailUi} />}
    {media && (media.references.length > 0 || media.assets.length > 0) && <div className="rounded-control border border-line p-4"><h3 className="text-sm font-bold">{t.mediaEvidenceHeading}</h3>
      {(media.references.length > 0 || media.assets.length > 0) && <details className="mt-3 text-ink-3"><summary className="cursor-pointer font-semibold">{t.imageSourcesDetails}</summary><p className="mt-2">{format(t.imageAssetsSummary, { refs: media.references.length, assets: media.assets.length })}</p><ul className="mt-2 space-y-1">{media.assets.map(asset => <li key={asset.sha256} className="break-all font-mono text-meta">{asset.sha256.slice(0, 16)}… · {asset.displayStatus} · {format(t.rightsPrefix, { rights: asset.rights })}</li>)}</ul></details>}
    </div>}
    {!!evidence.linkedPublisherRecords?.length && <div><h3 className="text-sm font-bold">{t.linkedPublisherHeading}</h3><p className="mt-1 text-ink-3">{t.linkedPublisherBody}</p><ul className="mt-3 space-y-2">{evidence.linkedPublisherRecords.map(record => <li key={record.id}><Link href={`/listings/${encodeURIComponent(record.id)}`} className="font-semibold underline">{record.source} · {record.parcelId}</Link><span className="ml-2 text-ink-3">{record.jurisdiction}</span></li>)}</ul></div>}
    {!!evidence.publisherConflicts?.length && <div className="rounded-control bg-catch-wash p-4"><h3 className="text-sm font-bold">{t.conflictsHeading}</h3><ul className="mt-2 space-y-2">{evidence.publisherConflicts.map((item, index) => <li key={index}>{format(t.conflictEntry, { field: item.field, here: readable(item.listingValue), there: readable(item.publisherValue) })} <Link className="underline" href={`/listings/${encodeURIComponent(item.listingId)}`}>{item.source}</Link>.</li>)}</ul></div>}
    {!!evidence.identityCandidates?.length && <details><summary className="cursor-pointer font-semibold">{format(t.addressCandidatesSummary, { count: evidence.identityCandidates.length })}</summary><ul className="mt-3 space-y-2">{evidence.identityCandidates.map(record => <li key={record.id}><Link className="underline" href={`/listings/${encodeURIComponent(record.id)}`}>{record.address} · {record.source}</Link></li>)}</ul></details>}
    {timeline && <details className="border-b border-line pb-4"><summary className="cursor-pointer text-sm font-semibold text-ink-2">{format(t.sourceHistorySummary, { total: timeline.total })}</summary>
      {!timeline.items.length && <p className="mt-3 text-ink-3">{t.noSnapshots}</p>}
      <ol className="mt-3 space-y-3">{timeline.items.map(item => <li key={item.snapshotId} className="border-l-2 border-line pl-3"><p className="font-semibold">{date(item.observedAt)} · {item.origin === 'archive' ? t.datedArchiveOrigin : item.origin}</p><p className="mt-1 text-ink-3">{item.kind === 'closed_result' ? t.closedResultSummary : t.publisherRecordSnapshot}</p><a className="mt-1 inline-block underline" href={item.evidenceUrl} target="_blank" rel="noreferrer" onClick={(event) => { if (!session.authenticated) { event.preventDefault(); session.requestUnlock(); } }}>{format(t.inspectRawEvidence, { sha: item.payloadSha256.slice(0, 12) })}</a></li>)}</ol>
      {timeline.truncated && <p className="mt-3 text-catch-ink">{t.snapshotsTruncated}</p>}
    </details>}
  </div>;
}
