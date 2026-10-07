// Client helpers for the public intelligence surfaces (neighborhoods, auction calendar, watchlist comps).
// These are read-only analytics. They go through the Next proxy to the Node API.
// No auth required on the server side for these endpoints.
//
// acknowledged-orphan: nothing imports this file.
//
// The three exports below are typed, and the three routes they call are served,
// admitted by the browser proxy, and covered by passing tests. None of that
// makes them reachable: no page mounts any of these surfaces, so a user cannot
// get to them. That gap was invisible until test/api-reachability.test.js
// started checking for a caller rather than only checking the proxy, and this
// file is listed in its KNOWN_PROXYABLE_NO_UI_CALLER set alongside
// /api/source-network/onboarding and /api/source-network/unbrowse/status.
//
// The decision this marker records is deliberate: the endpoints are kept,
// tested and correct, and rendering them is a product call rather than an
// oversight. Nothing in this file should be deleted until that call is made,
// and nothing here should be counted as a shipped feature.
//
// Two of these surfaces had real correctness bugs fixed behind this layer --
// auction-calendar and neighborhoods each read a fixed 1,000-row slice of a
// 9,831-row store and published statistics computed from it (the calendar
// reported 28 upcoming auctions against 3,417). Both now read the whole store
// and publish scanned / availableTotal / truncated. That work is invisible to
// users for as long as nothing mounts these surfaces, which is the argument
// for making the product call, not against it.

export type NeighborhoodBucket = {
  kind: string;
  key: string;
  label: string;
  count: number;
  medianOpeningBid: number | null;
  meanOpeningBid: number | null;
  medianSqft: number | null;
  medianDealScore: number | null;
  medianDiscount: number | null;
  sources: Record<string, number>;
  propTypes: Record<string, number>;
};

export type NeighborhoodsResponse = {
  schema: string;
  count: number;
  maxAgeDays: number;
  state: string | null;
  neighborhoods: NeighborhoodBucket[];
};

export type AuctionWeek = {
  weekStart: string;
  weekEnd: string;
  count: number;
  medianOpeningBid: number | null;
  meanOpeningBid: number | null;
  sources: Record<string, number>;
  propTypes: Record<string, number>;
  sample: Array<{ id: string; address?: string; state?: string; openingBid?: number | null; dealScore?: number | null }>;
};

export type AuctionCalendarResponse = {
  schema: string;
  windowDays: number;
  states: string[] | null;
  startMs: number;
  endMs: number;
  dropped: { noDate: number; outsideWindow: number };
  weeks: AuctionWeek[];
  total: number;
};

export type WatchlistCompsResponse = {
  schema: string;
  targetId: string;
  radiusKm: number;
  sqftBand: number;
  maxAgeDays: number;
  limit: number;
  comps: Array<{
    id: string;
    address?: string;
    state?: string;
    city?: string;
    zip?: string;
    openingBid?: number | null;
    dealScore?: number | null;
    sqft?: number | null;
    distanceKm?: number | null;
    score?: number | null;
  }>;
  stats: {
    count: number;
    medianOpeningBid: number | null;
    medianDealScore: number | null;
    medianDiscount: number | null;
  };
  dropped: { noGeo: number; tooFar: number; sqftOutOfBand: number; tooOld: number };
};

async function getJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json", ...(init?.headers || {}) }
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); if (j && typeof j.error === "string") msg = j.error; } catch {}
    const err = new Error(msg) as Error & { status?: number };
    (err as any).status = res.status;
    throw err;
  }
  return res.json() as Promise<T>;
}

export async function listNeighborhoods(params: { state?: string; maxAgeDays?: number; limit?: number } = {}): Promise<NeighborhoodsResponse> {
  const q = new URLSearchParams();
  if (params.state) q.set("state", params.state);
  if (params.maxAgeDays) q.set("maxAgeDays", String(params.maxAgeDays));
  if (params.limit) q.set("limit", String(params.limit));
  return getJson<NeighborhoodsResponse>(`/api/neighborhoods?${q.toString()}`);
}

export async function getAuctionCalendar(params: { windowDays?: number; states?: string; startMs?: number; sampleSize?: number } = {}): Promise<AuctionCalendarResponse> {
  const q = new URLSearchParams();
  if (params.windowDays) q.set("windowDays", String(params.windowDays));
  if (params.states) q.set("states", params.states);
  if (params.startMs) q.set("startMs", String(params.startMs));
  if (params.sampleSize) q.set("sampleSize", String(params.sampleSize));
  return getJson<AuctionCalendarResponse>(`/api/auction-calendar?${q.toString()}`);
}

export async function getWatchlistComps(listingId: string, params: { radiusKm?: number; sqftBand?: number; maxAgeDays?: number; limit?: number } = {}): Promise<WatchlistCompsResponse> {
  const q = new URLSearchParams();
  if (params.radiusKm) q.set("radiusKm", String(params.radiusKm));
  if (params.sqftBand) q.set("sqftBand", String(params.sqftBand));
  if (params.maxAgeDays) q.set("maxAgeDays", String(params.maxAgeDays));
  if (params.limit) q.set("limit", String(params.limit));
  return getJson<WatchlistCompsResponse>(`/api/watchlist/${encodeURIComponent(listingId)}/comps?${q.toString()}`);
}
