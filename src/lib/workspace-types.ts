export type SourceRecordRef = { sourceId: string; recordId: string };

export type CaseOrigin = {
  id?: string;
  type: "manual" | "browser_import" | "hunt_match" | "new_match" | "material_change" | "evaluation_unknown";
  observedAt?: string;
  changedFields?: string[];
  changes?: Record<string, { previous: unknown; current: unknown }>;
  huntId?: string;
  huntVersion?: number;
};

export type ReconsiderationCondition = {
  field: "openingBid" | "saleDate" | "status" | "sqft" | "requiredEvidence";
  operator: "changed" | "lte" | "gte" | "available";
  value?: string | number;
};

export type ReconsiderationPolicy = { mode: "any" | "all"; conditions: ReconsiderationCondition[] };

export type ResearchCaseSummary = {
  id: string;
  identityKey: string;
  sourceRef: SourceRecordRef;
  listingId: string;
  listingAliases?: string[];
  address: string | null;
  state: "inbox" | "pursue" | "pass";
  workspaceState: "inbox" | "pursue" | "pass";
  revision: number;
  decision: { state: string; reasonCodes: string[]; note?: string | null; decidedAt: string } | null;
  reconsideration: ReconsiderationPolicy | null;
  reconsiderationRequired: boolean;
  latestTrigger: { at: string; type: string; matchedConditions?: ReconsiderationCondition[] } | null;
  latestOrigin?: CaseOrigin | null;
  saleDate?: string | null;
  openingBid?: number | null;
  publishedStatus?: string | null;
  originCount: number;
  evidenceCount: number;
  createdAt: string;
  updatedAt: string;
};

export type Claim = { key?: string; title?: string; value?: unknown; evidenceClass?: string; sourceUrl?: string | null; observedAt?: string | null };
export type CaseHistory = { id?: string; type: string; at: string; revision?: number; [key: string]: unknown };
export type EvidenceLink = { intakeId: string; relationship: string; sourceId: string; sourceUrl: string; capturedAt: string; contentSha256: string; promotesFacts?: boolean };
export type ResearchCaseDetail = ResearchCaseSummary & {
  origins: CaseOrigin[];
  evidenceLinks: EvidenceLink[];
  listingSnapshot: Record<string, unknown>;
  dossierSnapshot: Record<string, unknown>;
  history: CaseHistory[];
  timeline: CaseHistory[];
};

export type ResearchDossier = {
  facts?: Claim[];
  gaps?: { key?: string; title?: string; reason?: string; nextAction?: string }[];
  signals?: { type?: string; severity?: string; title?: string; reason?: string; nextAction?: string }[];
  claimGroups?: { publisher?: Claim[]; official?: Claim[] };
  reviewedEvidence?: EvidenceLink[];
  [key: string]: unknown;
};
