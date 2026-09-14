import { ExternalLink, FileText } from 'lucide-react';
import type { DocumentEvidence } from '@/lib/document-evidence';
import { sourceDisplayText } from '@/lib/source-display';

const accessLabels: Record<DocumentEvidence['items'][number]['accessState'], string> = {
  public: 'Publisher reports public access',
  restricted: 'Restricted access',
  registration_required: 'Publisher registration required',
  unavailable: 'Reported unavailable',
  unknown: 'Access not established',
  link_available: 'Link captured · access not checked',
};

function safeLink(value: string | null | undefined) {
  try {
    const parsed = new URL(value || '');
    return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : null;
  } catch { return null; }
}

function observedDate(value: string | null) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(time) : null;
}

export function PropertyDocuments({ evidence, publisherUrl, id = 'property-documents' }: {
  evidence?: DocumentEvidence; publisherUrl?: string | null; id?: string;
}) {
  const sourceUrl = safeLink(evidence?.sourceUrl || publisherUrl);
  const items = evidence?.items || [];
  const status = evidence?.status || 'unknown';
  return <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
    <div className="flex items-center justify-between gap-3">
      <h2 id={`${id}-heading`} className="flex items-center gap-2 text-xl font-semibold tracking-tight"><FileText className="h-5 w-5 text-slate-500" />Documents</h2>
      {evidence?.count != null && <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{evidence.count} {evidence.count === 1 ? 'reference' : 'references'}</span>}
    </div>
    {status === 'unknown' ? <p className="mt-3 text-sm leading-6 text-slate-600">Document details haven’t been captured. Check the publisher for available files.</p>
      : status === 'none_observed' ? <p className="mt-3 text-sm leading-6 text-slate-600">No documents were listed in the captured record{observedDate(evidence!.observedAt) ? ` on ${observedDate(evidence!.observedAt)}` : ''}.</p>
      : <p className="mt-2 text-sm leading-6 text-slate-600">References from the publisher. A captured link does not mean the file was downloaded or reviewed.</p>}
    {evidence?.disagreement && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">Captured document lists differ. Both are retained below for review.</p>}
    {items.length > 0 && <ul className="mt-4 divide-y divide-slate-100 border-y border-slate-100">
      {items.map((item, index) => {
        const href = safeLink(item.url);
        const label = sourceDisplayText(item.label || `Publisher document ${index + 1}`);
        const observed = observedDate(item.observedAt);
        return <li key={`${item.provenance.sourceField}:${index}`} className="py-4">
          {href ? <a href={href} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center gap-2 break-words text-sm font-semibold text-slate-950 underline decoration-slate-300 underline-offset-4 hover:decoration-slate-950">{label}<ExternalLink className="h-3.5 w-3.5 shrink-0" /></a> : <p className="text-sm font-semibold text-slate-950">{label}</p>}
          <p className="mt-1 text-xs leading-5 text-slate-600">{accessLabels[item.accessState] || accessLabels.unknown}{!href ? ' · Link not captured' : ''}</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">{item.provenance.origin === 'archived_publisher_snapshot' ? 'Archive reference' : 'Publisher reference'}{observed ? ` · Observed ${observed}` : ' · Observation date unknown'}</p>
        </li>;
      })}
    </ul>}
    {evidence?.truncated && <p className="mt-3 text-xs leading-5 text-amber-800">Some captured references cannot be displayed here. Inspect the publisher record and saved evidence for the complete list.</p>}
    {sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-slate-700 underline underline-offset-4">Check publisher documents<ExternalLink className="h-3.5 w-3.5" /></a>}
  </section>;
}
