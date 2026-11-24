// Device watchlist persistence & idempotent server sync helper shared with /listings.
export const SAVED_LISTINGS_DEVICE_KEY = "perfectproperty:saved-listings";

export type WatchlistStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type WatchlistSyncResult = {
  ids: string[];
  savedCount: number;
  syncedIds: string[];
  remainingLocalIds: string[];
};

const sessionSkippedIds = new Set<string>();
let inFlightDefaultSync: Promise<WatchlistSyncResult> | null = null;

function resolveStorage(storage?: WatchlistStorage | null): WatchlistStorage | null {
  if (storage !== undefined) return storage;
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function dedupeIds(values: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of values) {
    if (typeof item !== "string" || item.length === 0 || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/**
 * Reads saved listing IDs from device storage (`perfectproperty:saved-listings`).
 */
export function readDeviceWatchlistIds(storage?: WatchlistStorage | null): string[] {
  const target = resolveStorage(storage);
  if (!target) return [];
  try {
    const parsed = JSON.parse(target.getItem(SAVED_LISTINGS_DEVICE_KEY) || "[]");
    return Array.isArray(parsed) ? dedupeIds(parsed) : [];
  } catch {
    return [];
  }
}

/**
 * Persists saved listing IDs to device storage, clearing the key when empty.
 */
export function writeDeviceWatchlistIds(ids: string[], storage?: WatchlistStorage | null): boolean {
  const target = resolveStorage(storage);
  if (!target) return false;
  const next = dedupeIds(ids);
  try {
    if (next.length > 0) {
      target.setItem(SAVED_LISTINGS_DEVICE_KEY, JSON.stringify(next));
    } else {
      target.removeItem(SAVED_LISTINGS_DEVICE_KEY);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Toggles a single listing ID in device storage for signed-out visitors.
 */
export function toggleDeviceWatchlistId(
  listingId: string,
  currentlySaved: boolean,
  storage?: WatchlistStorage | null,
): { ok: boolean; saved: boolean; ids: string[] } {
  const current = readDeviceWatchlistIds(storage);
  const next = currentlySaved
    ? current.filter((id) => id !== listingId)
    : dedupeIds([...current, listingId]);
  const ok = writeDeviceWatchlistIds(next, storage);
  return {
    ok,
    saved: ok ? !currentlySaved : currentlySaved,
    ids: ok ? next : current,
  };
}

/**
 * Removes a single listing ID from device storage if present.
 */
export function removeDeviceWatchlistId(
  listingId: string,
  storage?: WatchlistStorage | null,
): string[] {
  const current = readDeviceWatchlistIds(storage);
  const next = current.filter((id) => id !== listingId);
  if (next.length !== current.length) {
    writeDeviceWatchlistIds(next, storage);
  }
  return next;
}

/**
 * Extracts listing IDs from `/api/alerts` GET response payloads.
 */
export function extractAlertDealIds(payload: unknown): string[] {
  if (!payload || typeof payload !== "object") return [];
  const deals = (payload as { deals?: unknown }).deals;
  if (!Array.isArray(deals)) return [];
  return dedupeIds(
    deals.map((deal) =>
      typeof deal === "string"
        ? deal
        : (deal as { listingId?: unknown; id?: unknown })?.listingId ??
          (deal as { listingId?: unknown; id?: unknown })?.id,
    ),
  );
}

/**
 * Clears in-memory skipped IDs (e.g. on sign-out or local toggle) so future
 * sign-ins can re-attempt synchronization.
 */
export function resetWatchlistSyncSession(): void {
  sessionSkippedIds.clear();
}

async function fetchAlertsSnapshot(fetchFn: typeof fetch): Promise<{ ids: string[]; savedCount: number }> {
  const response = await fetchFn("/api/alerts", { credentials: "same-origin", cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      data && typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : "Watchlist could not be loaded.";
    throw new Error(message);
  }
  const ids = extractAlertDealIds(data);
  const rawCount = (data as { savedCount?: unknown })?.savedCount;
  const savedCount = typeof rawCount === "number" && Number.isFinite(rawCount)
    ? Math.max(rawCount, ids.length)
    : ids.length;
  return { ids, savedCount };
}

async function performWatchlistSync(options: {
  storage?: WatchlistStorage | null;
  fetchImpl?: typeof fetch;
  skippedIds?: Set<string>;
} = {}): Promise<WatchlistSyncResult> {
  const fetchFn = options.fetchImpl ?? fetch;
  const skipped = options.skippedIds ?? sessionSkippedIds;

  const initial = await fetchAlertsSnapshot(fetchFn);
  const localIds = readDeviceWatchlistIds(options.storage);
  if (localIds.length === 0) {
    return {
      ids: initial.ids,
      savedCount: initial.savedCount,
      syncedIds: [],
      remainingLocalIds: [],
    };
  }

  const serverSet = new Set(initial.ids);
  const alreadyOnServer = localIds.filter((id) => serverSet.has(id));
  const unsynced = localIds.filter((id) => !serverSet.has(id) && !skipped.has(id));

  const postResults = await Promise.all(
    unsynced.map(async (listingId) => {
      try {
        const response = await fetchFn("/api/alerts", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listingId }),
        });
        if (response.ok) {
          return { listingId, accepted: true, permanentReject: false };
        }
        return {
          listingId,
          accepted: false,
          permanentReject: response.status === 400 || response.status === 404,
        };
      } catch {
        return { listingId, accepted: false, permanentReject: false };
      }
    }),
  );

  const accepted: string[] = [];
  for (const entry of postResults) {
    if (entry.accepted) {
      accepted.push(entry.listingId);
    } else if (entry.permanentReject) {
      skipped.add(entry.listingId);
    }
  }

  const reconciled = new Set([...alreadyOnServer, ...accepted]);
  let remainingLocalIds = localIds;
  if (reconciled.size > 0) {
    const latestLocal = readDeviceWatchlistIds(options.storage);
    const left = latestLocal.filter((id) => !reconciled.has(id));
    if (writeDeviceWatchlistIds(left, options.storage)) {
      remainingLocalIds = left;
    }
  }

  if (accepted.length === 0) {
    return {
      ids: initial.ids,
      savedCount: initial.savedCount,
      syncedIds: [],
      remainingLocalIds,
    };
  }

  try {
    const refreshed = await fetchAlertsSnapshot(fetchFn);
    return {
      ids: refreshed.ids,
      savedCount: refreshed.savedCount,
      syncedIds: accepted,
      remainingLocalIds,
    };
  } catch {
    const mergedIds = dedupeIds([...initial.ids, ...accepted]);
    return {
      ids: mergedIds,
      savedCount: Math.max(initial.savedCount, mergedIds.length),
      syncedIds: accepted,
      remainingLocalIds,
    };
  }
}

/**
 * Reconciles guest device watchlist IDs into `/api/alerts` when signed in,
 * deduplicating concurrent browser syncs to prevent duplicate POST loops.
 */
export function syncDeviceWatchlistToServer(options: {
  storage?: WatchlistStorage | null;
  fetchImpl?: typeof fetch;
  skippedIds?: Set<string>;
} = {}): Promise<WatchlistSyncResult> {
  const usesDefaults = !options.storage && !options.fetchImpl && !options.skippedIds;
  if (usesDefaults) {
    if (inFlightDefaultSync) return inFlightDefaultSync;
    inFlightDefaultSync = performWatchlistSync(options).finally(() => {
      inFlightDefaultSync = null;
    });
    return inFlightDefaultSync;
  }
  return performWatchlistSync(options);
}
