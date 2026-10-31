import { createRequire } from "node:module";

export type CountyRow = { county: string; count: number; sources: string[] };

export type CoveragePayload = {
  liveByState?: {
    byStateTotal?: Record<string, unknown>;
    byCounty?: Record<string, unknown>;
    readError?: string | null;
  };
};

export function formatStateRows(totals: Record<string, unknown>): { state: string; count: number }[] {
  return Object.entries(totals)
    .flatMap(([state, count]) => {
      if (!/^[A-Z]{2}$/.test(state) || typeof count !== "number" || !Number.isFinite(count) || count <= 0) return [];
      return [{ state, count }];
    })
    .sort((left, right) => right.count - left.count || left.state.localeCompare(right.state));
}

export function formatCountyRows(raw: unknown): CountyRow[] {
  return Array.isArray(raw)
    ? raw.flatMap((row) => {
        if (!row || typeof row !== "object") return [];
        const county = (row as { county?: unknown }).county;
        const count = (row as { count?: unknown }).count;
        const sources = (row as { sources?: unknown }).sources;
        if (typeof county !== "string" || county.trim().length < 2) return [];
        if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) return [];
        const names = Array.isArray(sources)
          ? sources.filter((item): item is string => typeof item === "string" && item.length > 0)
          : [];
        return [{ county, count, sources: names }];
      })
    : [];
}

function getSummarize(): () => any {
  if (typeof require !== "undefined") {
    try {
      return require("@server/discovery/coverage-matrix").summarize;
    } catch {}
  }
  try {
    const req = createRequire(import.meta.url);
    try {
      return req("@server/discovery/coverage-matrix").summarize;
    } catch {}
    try {
      return req("../../server/discovery/coverage-matrix").summarize;
    } catch {}
  } catch {}
  const reqRoot = createRequire(process.cwd() + "/package.json");
  return reqRoot("./server/discovery/coverage-matrix").summarize;
}

export async function loadStateCounts(): Promise<{ rows: { state: string; count: number }[]; error: string | null }> {
  const apiUrl = process.env.PROPERTY_API_URL || "http://localhost:3000";
  // First attempt: fetch from ${apiUrl}/api/coverage with a 4s timeout
  try {
    const response = await fetch(`${apiUrl}/api/coverage`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    });
    if (response.ok) {
      const body = (await response.json()) as CoveragePayload;
      if (!body.liveByState?.readError) {
        const totals = body.liveByState?.byStateTotal || {};
        const rows = formatStateRows(totals);
        if (rows.length > 0) {
          return { rows, error: null };
        }
      }
    }
  } catch {
    // API not reachable, timed out, or returned an error; fall through to local matrix
  }

  // Second attempt: directly compute from local coverage matrix engine without any external network dependency
  try {
    const summarize = getSummarize();
    const matrix = summarize();
    const totals = matrix.liveByState?.byStateTotal || {};
    const rows = formatStateRows(totals);
    return { rows, error: null };
  } catch {
    return { rows: [], error: "We couldn't load the list of states right now. Please try again in a minute." };
  }
}

export async function loadStateCounties(state: string): Promise<{ total: number; counties: CountyRow[]; error: string | null }> {
  const apiUrl = process.env.PROPERTY_API_URL || "http://localhost:3000";
  // First attempt: fetch from ${apiUrl}/api/coverage with a 4s timeout
  try {
    const response = await fetch(`${apiUrl}/api/coverage`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    });
    if (response.ok) {
      const body = (await response.json()) as CoveragePayload;
      if (!body.liveByState?.readError) {
        const totalRaw = body.liveByState?.byStateTotal?.[state];
        const total = typeof totalRaw === "number" && Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : 0;
        const raw = body.liveByState?.byCounty?.[state];
        const counties = formatCountyRows(raw);
        if (total > 0 || counties.length > 0) {
          return { total, counties, error: null };
        }
      }
    }
  } catch {
    // API not reachable, timed out, or returned an error; fall through to local matrix
  }

  // Second attempt: directly compute from local coverage matrix engine without any external network dependency
  try {
    const summarize = getSummarize();
    const matrix = summarize();
    const totalRaw = matrix.liveByState?.byStateTotal?.[state];
    const total = typeof totalRaw === "number" && Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : 0;
    const raw = matrix.liveByState?.byCounty?.[state];
    const counties = formatCountyRows(raw);
    return { total, counties, error: null };
  } catch {
    return { total: 0, counties: [], error: "We couldn't load this state's counties right now. Please try again in a minute." };
  }
}
