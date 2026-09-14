/** Canonical Node document-evidence response. No browser-side inference. */
export type DocumentEvidence = {
  status: 'observed' | 'none_observed' | 'unknown';
  count: number | null;
  observedAt: string | null;
  sourceUrl: string | null;
  truncated?: boolean;
  disagreement?: boolean;
  containers?: Record<string, { count: number }>;
  items: {
    label: string | null;
    url: string | null;
    accessState: 'public' | 'restricted' | 'registration_required' | 'unavailable' | 'unknown' | 'link_available';
    observedAt: string | null;
    provenance: {
      origin: 'publisher_record' | 'archived_publisher_snapshot';
      sourceField: string;
      sourceRecordUrl: string | null;
    };
  }[];
};
