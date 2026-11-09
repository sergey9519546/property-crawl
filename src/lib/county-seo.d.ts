export interface CountyStats {
  totalCount: number;
  medianOpeningBid: number | null;
  medianDealScore: number | null;
  sourceBreakdown: Record<string, number>;
  propertyTypes: Record<string, number>;
}

export interface StatutoryUpsetBidInfo {
  hasUpsetBid: boolean;
  windowDays: number;
  minDepositPct?: number | null;
  minDepositFloor?: number | null;
  statute?: string | null;
  description?: string | null;
}

export interface StatutoryHomesteadDistinction {
  hasDistinction: boolean;
  homesteadDays: number | null;
  nonHomesteadDays: number | null;
  statute?: string | null;
  interestRatePct?: number | null;
  description?: string | null;
}

export interface StatutoryRedemptionInfo {
  days: number | null;
  label: string;
  stateCode: string;
  upsetBid?: StatutoryUpsetBidInfo;
  homesteadDistinction?: StatutoryHomesteadDistinction | null;
  statuteCitation?: string | null;
}

export interface StatutoryEstimatedFees {
  baselinePrice: number;
  transferTax: number;
  sheriffPoundage: number;
  recordingFee: number;
  estimatedDeposit: number;
  totalEstimatedClosingCosts: number;
}

export interface StatutoryFeeSchedule {
  state: string;
  name: string;
  isSupported: boolean;
  scheduleLabel: string;
  transferTaxRatePerThousand: number;
  transferTaxCitation: string;
  sheriffPoundageRatePercent: number;
  sheriffPoundageCitation: string;
  settlementWindowHours: number;
  settlementDeadlineDescription: string;
  depositRequirement: string;
  citations: string[];
  estimatedFees: StatutoryEstimatedFees;
}

export interface CountyMetadataResult {
  title: string;
  description: string;
  alternates: {
    canonical: string;
  };
  openGraph: {
    title: string;
    description: string;
    url: string;
    siteName: string;
    type: string;
  };
}

export function normalizeCountySlug(raw: string | null | undefined): string;
export function countyToSlug(county: string | null | undefined): string;
export function formatCountyDisplayName(county: string | null | undefined): string;
export function computeCountyStats(listings?: unknown[]): CountyStats;
export function getStatutoryRedemption(stateCode: string | null | undefined): StatutoryRedemptionInfo;
export function getStatutoryFeeSchedule(stateCode: string | null | undefined, baselinePrice?: number | null): StatutoryFeeSchedule;
export function generateHighCtrCountyTitle(county: string | null | undefined, state: string | null | undefined): string;
export function generateCountyMetadata(params: {
  state: string;
  county: string;
  count?: number;
  medianBid?: number | null;
  baseUrl?: string;
  format?: 'standard' | 'high-ctr';
}): CountyMetadataResult;
export function buildCountyBreadcrumbs(params: {
  state: string;
  county: string;
  baseUrl?: string;
}): Record<string, unknown>;
export function buildCountyItemList(params: {
  state: string;
  county: string;
  listings?: unknown[];
  baseUrl?: string;
}): Record<string, unknown>;
export function buildCountyFaqSchema(params: {
  state: string;
  county: string;
  baseUrl?: string;
  listings?: unknown[];
}): Record<string, unknown>;

export const DEFAULT_BASE_URL: string;
