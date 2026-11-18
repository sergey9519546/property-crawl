import { ExternalLink, FileText } from 'lucide-react';
import type { DocumentEvidence } from '@/lib/document-evidence';
import { sourceDisplayText } from '@/lib/source-display';
import type { Messages } from '@/lib/i18n/messages/en';
import { formatLocaleDate, interpolate, selectPlural } from '@/lib/i18n/translator';
import type { Locale } from '@/lib/i18n/config';

const DEFAULT_ACCESS_LABELS: Record<DocumentEvidence['items'][number]['accessState'], string> = {
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

function observedDate(value: string | null, intlLocale = 'en-US', locale?: Locale) {
  const time = Date.parse(value || '');
  const resolvedLocale: Locale = locale || (intlLocale === 'hy-AM' ? 'hy' : intlLocale === 'ru-RU' ? 'ru' : 'en');
  return Number.isFinite(time) ? formatLocaleDate(resolvedLocale, time, { dateStyle: 'medium', timeZone: 'UTC' }) : null;
}

export function PropertyDocuments({ evidence, publisherUrl, id = 'property-documents', locale = 'en', intlLocale = 'en-US', labels }: {
  evidence?: DocumentEvidence;
  publisherUrl?: string | null;
  id?: string;
  locale?: Locale;
  intlLocale?: string;
  labels?: Messages['detailUi'];
}) {
  const sourceUrl = safeLink(evidence?.sourceUrl || publisherUrl);
  const items = evidence?.items || [];
  const status = evidence?.status || 'unknown';
  const countText = evidence?.count != null
    ? (labels
        ? selectPlural(locale, evidence.count, labels.docsRefsCount)
        : `${evidence.count} ${evidence.count === 1 ? 'reference' : 'references'}`)
    : null;
  const accessLabels: Record<DocumentEvidence['items'][number]['accessState'], string> = labels
    ? {
        public: labels.docAccessPublic,
        restricted: labels.docAccessRestricted,
        registration_required: labels.docAccessRegReq,
        unavailable: labels.docAccessUnavail,
        unknown: labels.docAccessUnknown,
        link_available: labels.docAccessLinkAvail,
      }
    : DEFAULT_ACCESS_LABELS;
  const obsNoneDate = status === 'none_observed' ? observedDate(evidence!.observedAt, intlLocale, locale) : null;

  return <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-6 rounded-2xl border border-line bg-card p-5 shadow-sm sm:p-6">
    <div className="flex items-center justify-between gap-3">
      <h2 id={`${id}-heading`} className="flex items-center gap-2 text-xl font-semibold tracking-tight"><FileText className="h-5 w-5 text-ink-3" />{labels ? labels.docsTitle : 'Documents'}</h2>
      {countText && <span className="rounded-full bg-line px-3 py-1 text-xs font-medium text-ink-3">{countText}</span>}
    </div>
    {status === 'unknown' ? <p className="mt-3 text-sm leading-6 text-ink-3">{labels ? labels.docsUnknown : "Document details haven’t been captured. Check the publisher for available files."}</p>
      : status === 'none_observed' ? <p className="mt-3 text-sm leading-6 text-ink-3">{labels ? (obsNoneDate ? interpolate(labels.docsNoneObservedOn, { date: obsNoneDate }) : labels.docsNoneObserved) : `No documents were listed in the captured record${obsNoneDate ? ` on ${obsNoneDate}` : ''}.`}</p>
      : <p className="mt-2 text-sm leading-6 text-ink-3">{labels ? labels.docsCapturedNote : 'References from the publisher. A captured link does not mean the file was downloaded or reviewed.'}</p>}
    {evidence?.disagreement && <p className="mt-3 rounded-lg bg-catch-wash px-3 py-2 text-sm text-catch-ink">{labels ? labels.docsDisagreement : 'Captured document lists differ. Both are retained below for review.'}</p>}
    {items.length > 0 && <ul className="mt-4 divide-y divide-line border-y border-line">
      {items.map((item, index) => {
        const href = safeLink(item.url);
        const label = sourceDisplayText(item.label || (labels ? interpolate(labels.docItemFallback, { index: index + 1 }) : `Publisher document ${index + 1}`));
        const observed = observedDate(item.observedAt, intlLocale, locale);
        return <li key={`${item?.provenance?.sourceField || 'doc'}:${index}`} className="py-4">
          {href ? <a href={href} target="_blank" rel="noreferrer" className="inline-flex min-h-8 items-center gap-2 break-words text-sm font-semibold text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">{label}<ExternalLink className="h-3.5 w-3.5 shrink-0" /></a> : <p className="text-sm font-semibold text-ink">{label}</p>}
          <p className="mt-1 text-xs leading-5 text-ink-3">{accessLabels[item.accessState] || accessLabels.unknown}{!href ? (labels ? labels.docLinkNotCaptured : ' · Link not captured') : ''}</p>
          <p className="mt-1 text-xs leading-5 text-ink-3">{item?.provenance?.origin === 'archived_publisher_snapshot' ? (labels ? labels.docArchiveRef : 'Archive reference') : (labels ? labels.docPublisherRef : 'Publisher reference')}{observed ? (labels ? interpolate(labels.docObservedPart, { date: observed }) : ` · Observed ${observed}`) : (labels ? labels.docObsDateUnknown : ' · Observation date unknown')}</p>
        </li>;
      })}
    </ul>}
    {evidence?.truncated && <p className="mt-3 text-xs leading-5 text-catch-ink">{labels ? labels.docTruncatedNotice : 'Some captured references cannot be displayed here. Inspect the publisher record and saved evidence for the complete list.'}</p>}
    {sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-ink-2 underline underline-offset-4">{labels ? labels.checkPublisherDocs : 'Check publisher documents'}<ExternalLink className="h-3.5 w-3.5" /></a>}
  </section>;
}
