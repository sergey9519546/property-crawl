import Link from 'next/link';

export type DiscoveryEvidenceData = {
  evidenceTimeline?: { total: number; truncated: boolean; items: { snapshotId: string; observedAt: string; origin: string; kind: string; payloadSha256: string; evidenceUrl: string }[] };
  linkedPublisherRecords?: { id: string; source: string; parcelId: string; jurisdiction: string; observedAt: string; sourceUrl: string }[];
  identityCandidates?: { id: string; source: string; address: string }[];
  publisherConflicts?: { field: string; listingValue: unknown; publisherValue: unknown; listingId: string; source: string }[];
  mediaEvidence?: { references: unknown[]; assets: { sha256: string; displayStatus: string; rights: string }[]; documents: Record<string, unknown>[] | null };
  saleMechanics?: { scheduledTime: string | null; timeZone: string | null; windowStart: string | null; windowEnd: string | null; location: string | null; method: string | null };
};
const readable = (value: unknown) => value === null || value === undefined ? 'Not supplied' : String(value);
const date = (value: string) => new Date(value).toLocaleString();
const url = (value: unknown) => { try { const parsed = new URL(String(value)); return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : null; } catch { return null; } };

export function DiscoveryEvidence({ evidence }: { evidence: DiscoveryEvidenceData }) {
  const { evidenceTimeline: timeline, mediaEvidence: media, saleMechanics: sale } = evidence;
  return <div className="space-y-5 text-xs">
    {sale && <div className="rounded-xl border border-slate-200 p-4"><h3 className="text-sm font-bold">Sale timing and mechanics</h3><dl className="mt-3 grid gap-3 sm:grid-cols-2">
      <div><dt className="text-slate-500">Supplied time / time zone</dt><dd>{readable(sale.scheduledTime)} / {readable(sale.timeZone)}</dd></div>
      <div><dt className="text-slate-500">Auction method</dt><dd>{readable(sale.method)}</dd></div>
      <div><dt className="text-slate-500">Publisher’s auction window</dt><dd>{readable(sale.windowStart)} → {readable(sale.windowEnd)}</dd></div>
      <div><dt className="text-slate-500">Sale location</dt><dd>{readable(sale.location)}</dd></div>
    </dl></div>}
    {media && <div className="rounded-xl border border-slate-200 p-4"><h3 className="text-sm font-bold">Documents and media evidence</h3>
      <p className="mt-2 text-slate-600">{media.references.length} image references · {media.assets.length} indexed files. Display eligibility is reviewed separately from file integrity.</p>
      {media.documents === null ? <p className="mt-2 text-amber-800">Document inventory was not supplied.</p> : !media.documents.length ? <p className="mt-2 text-slate-500">The captured document inventory is empty.</p> : <ul className="mt-3 space-y-2">{media.documents.map((document, index) => {
        const href = url(document.url || document.documentUrl || document.documentURL || document.fileUrl);
        const title = String(document.title || document.name || document.documentName || `Publisher document ${index + 1}`);
        return <li key={index}>{href ? <a href={href} target="_blank" rel="noreferrer" className="font-semibold underline">{title}</a> : <span>{title} · link unavailable</span>}</li>;
      })}</ul>}
      {media.assets.length > 0 && <details className="mt-3"><summary className="cursor-pointer font-semibold">File integrity and reuse status</summary><ul className="mt-2 space-y-1">{media.assets.map(asset => <li key={asset.sha256} className="break-all font-mono text-[10px]">{asset.sha256.slice(0, 16)}… · {asset.displayStatus} · rights: {asset.rights}</li>)}</ul></details>}
    </div>}
    {!!evidence.linkedPublisherRecords?.length && <div><h3 className="text-sm font-bold">Linked publisher records</h3><p className="mt-1 text-slate-500">These records share an exact parcel identifier and jurisdiction. Each publisher’s facts remain separate.</p><ul className="mt-3 space-y-2">{evidence.linkedPublisherRecords.map(record => <li key={record.id}><Link href={`/listings/${encodeURIComponent(record.id)}`} className="font-semibold underline">{record.source} · {record.parcelId}</Link><span className="ml-2 text-slate-500">{record.jurisdiction}</span></li>)}</ul></div>}
    {!!evidence.publisherConflicts?.length && <div className="rounded-xl bg-amber-50 p-4"><h3 className="text-sm font-bold">Publisher records disagree</h3><ul className="mt-2 space-y-2">{evidence.publisherConflicts.map((item, index) => <li key={index}>{item.field}: {readable(item.listingValue)} here; {readable(item.publisherValue)} at <Link className="underline" href={`/listings/${encodeURIComponent(item.listingId)}`}>{item.source}</Link>.</li>)}</ul></div>}
    {!!evidence.identityCandidates?.length && <details><summary className="cursor-pointer font-semibold">{evidence.identityCandidates.length} address candidates require identity review</summary><ul className="mt-3 space-y-2">{evidence.identityCandidates.map(record => <li key={record.id}><Link className="underline" href={`/listings/${encodeURIComponent(record.id)}`}>{record.address} · {record.source}</Link></li>)}</ul></details>}
    {timeline && <details open className="rounded-xl border border-slate-200 p-4"><summary className="cursor-pointer text-sm font-bold">Evidence timeline · {timeline.total} snapshots</summary>
      {!timeline.items.length && <p className="mt-3 text-slate-500">No durable snapshots have been captured for this publisher record.</p>}
      <ol className="mt-3 space-y-3">{timeline.items.map(item => <li key={item.snapshotId} className="border-l-2 border-slate-200 pl-3"><p className="font-semibold">{date(item.observedAt)} · {item.origin === 'archive' ? 'Dated archive' : item.origin}</p><p className="mt-1 text-slate-500">{item.kind === 'closed_result' ? 'Closed-result summary; completed sale remains unverified' : 'Publisher record snapshot'}</p><a className="mt-1 inline-block underline" href={item.evidenceUrl} target="_blank" rel="noreferrer">Inspect raw evidence · {item.payloadSha256.slice(0, 12)}</a></li>)}</ol>
      {timeline.truncated && <p className="mt-3 text-amber-800">Showing the latest 100 snapshots. Older evidence remains stored.</p>}
    </details>}
  </div>;
}
