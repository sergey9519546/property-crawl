export interface CountyStats {
  totalCount: number;
  medianOpeningBid: number | null;
  medianDealScore: number | null;
  sourceBreakdown: Record<string, number>;
  propertyTypes: Record<string, number>;
}

export interface StatutoryRedemptionInfo {
  days: number | null;
  label: string;
  stateCode: string;
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
export function generateCountyMetadata(params: {
  state: string;
  county: string;
  count?: number;
  medianBid?: number | null;
  baseUrl?: string;
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

export const DEFAULT_BASE_URL: string;
