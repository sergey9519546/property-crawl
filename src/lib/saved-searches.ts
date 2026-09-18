// Client view model used by the Alerts UI (flattened for the current simple form).
export type SavedSearch = { id: string; name: string; state: string; minScore: number; maxBid: number; createdAt: string };

// Server record shape returned by /api/saved-searches
export type ServerSavedSearch = {
  id: string;
  label: string | null;
  filters: Record<string, unknown>;
  isActive: boolean;
  lastRunAt?: string | null;
  lastMatchCount?: number | null;
  createdAt: string;
  updatedAt: string;
};

export function matchesSavedSearch(listing: { state?: string; dealScore?: number | null; openingBid?: number | null }, search: SavedSearch) {
  if (search.state !== "All" && listing.state !== search.state) return false;
  if (search.minScore > 0 && (typeof listing.dealScore !== "number" || !Number.isFinite(listing.dealScore) || listing.dealScore < search.minScore)) return false;
  if (search.maxBid > 0 && (typeof listing.openingBid !== "number" || !Number.isFinite(listing.openingBid) || listing.openingBid > search.maxBid)) return false;
  return true;
}

// Convert server record + filters to the UI SavedSearch shape for onApply + rendering.
export function toClientSavedSearch(s: ServerSavedSearch): SavedSearch {
  const f = (s.filters || {}) as any;
  const states: string[] = Array.isArray(f.states) ? f.states : [];
  const state = states.length > 0 ? String(states[0]).toUpperCase() : "All";
  const minScore = Number.isFinite(f.minScore) ? Number(f.minScore) : 0;
  const maxBid = Number.isFinite(f.maxBid) ? Number(f.maxBid) : 0;
  return {
    id: s.id,
    name: s.label || (state === "All" ? "All-market search" : `${state} opportunities`),
    state,
    minScore: Math.max(0, Math.min(100, minScore)),
    maxBid: Math.max(0, maxBid),
    createdAt: s.createdAt
  };
}

export function parseSavedSearches(raw: string | null): SavedSearch[] {
  if (!raw || raw.length > 128_000) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((item) => item && typeof item.id === "string" && item.id.length <= 100
      && typeof item.name === "string" && item.name.length <= 80
      && typeof item.state === "string" && /^(All|[A-Z]{2})$/.test(item.state)
      && Number.isFinite(item.minScore) && item.minScore >= 0 && item.minScore <= 100
      && Number.isFinite(item.maxBid) && item.maxBid >= 0 && item.maxBid <= 50_000_000
      && typeof item.createdAt === "string").slice(0, 50);
  } catch { return []; }
}

// Build server filters payload from the current simple UI controls.
export function buildServerFilters(state: string, minScore: number, maxBid: number) {
  const filters: Record<string, unknown> = {};
  if (state && state !== "All") filters.states = [state];
  if (minScore > 0) filters.minScore = minScore;
  if (maxBid > 0) filters.maxBid = maxBid;
  return filters;
}

// --- Client API helpers (authenticated via workspace session cookie) ---

export type ApiError = { status: number; error: string };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {})
    },
    cache: "no-store"
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j && typeof j.error === "string") msg = j.error;
    } catch {}
    const err = new Error(msg) as Error & { status?: number };
    (err as any).status = res.status;
    throw err;
  }
  if (res.status === 204) return {} as T;
  return res.json() as Promise<T>;
}

export async function listSavedSearches(): Promise<ServerSavedSearch[]> {
  const data = await api<{ searches?: ServerSavedSearch[] }>("/api/saved-searches");
  return Array.isArray(data.searches) ? data.searches : [];
}

export async function createSavedSearch(label: string | null, filters: Record<string, unknown>): Promise<ServerSavedSearch> {
  return api<ServerSavedSearch>("/api/saved-searches", {
    method: "POST",
    body: JSON.stringify({ label, filters })
  });
}

export async function updateSavedSearch(id: string, updates: { label?: string; isActive?: boolean; filters?: Record<string, unknown> }): Promise<ServerSavedSearch> {
  return api<ServerSavedSearch>(`/api/saved-searches/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(updates)
  });
}

export async function deleteSavedSearch(id: string): Promise<{ success: boolean; id: string }> {
  return api(`/api/saved-searches/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function runSavedSearch(id: string): Promise<{ searchId: string; label: string | null; newMatches: number; scanned: number }> {
  return api(`/api/saved-searches/${encodeURIComponent(id)}/run`);
}

export type AlertMatch = {
  id: string;
  searchId: string;
  listingId: string;
  matchedAt: string;
  readAt: string | null;
  listing?: { id: string; address?: string; state?: string; openingBid?: number | null; dealScore?: number | null } | null;
};

export type AlertMatchesPage = {
  matches: AlertMatch[];
  nextCursor: string | null;
};

export async function listAlertMatches(onlyUnread?: boolean, limit?: number): Promise<AlertMatch[]>;
export async function listAlertMatches(onlyUnread: boolean | undefined, limit: number | undefined, cursor: string): Promise<AlertMatchesPage>;
export async function listAlertMatches(onlyUnread?: boolean, limit?: number, cursor?: string): Promise<AlertMatch[] | AlertMatchesPage> {
  const q = new URLSearchParams();
  if (onlyUnread) q.set("onlyUnread", "true");
  if (limit) q.set("limit", String(limit));
  if (cursor) q.set("cursor", cursor);
  const data = await api<{ matches?: AlertMatch[]; nextCursor?: string | null }>(`/api/alerts/matches?${q.toString()}`);
  const matches = Array.isArray(data.matches) ? data.matches : [];
  if (cursor !== undefined) {
    return { matches, nextCursor: data.nextCursor ?? null };
  }
  return matches;
}

export async function markAlertMatchesRead(matchIds: string[]): Promise<{ markedRead: number }> {
  if (!matchIds.length) return { markedRead: 0 };
  return api("/api/alerts/matches", {
    method: "POST",
    body: JSON.stringify({ action: "mark_read", matchIds })
  });
}

export async function getUnreadAlertCount(): Promise<number> {
  // The badge only needs the unread count; a single page fetch is cheap and
  // keeps the endpoint contract (matches + cursor) unchanged.
  const allUnread = await listAlertMatches(true, 200);
  return allUnread.length;
}
