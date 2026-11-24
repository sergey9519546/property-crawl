export const UNDERWRITE_SCENARIO_KEY = "pp_underwrite_scenario";
export const UNDERWRITE_SCENARIO_LOCAL_PREFIX = "pp:underwrite-scenario:v1:";
export const UNDERWRITE_SCENARIO_EVENT = "pp:underwrite-scenario-updated";

export const underwriteFields = [
  "registrationFunds",
  "creditedDeposit",
  "buyersPremium",
  "sheriffPoundage",
  "transferTax",
  "delinquentTaxes",
  "settlementCosts",
] as const;

export type UnderwriteField = (typeof underwriteFields)[number];

export interface UnderwriteScenario {
  registrationFunds: string;
  creditedDeposit: string;
  buyersPremium: string;
  sheriffPoundage: string;
  transferTax: string;
  delinquentTaxes: string;
  settlementCosts: string;
  rehabBudget: number;
  targetMargin: number;
  customValuation?: string;
  customOpeningBid?: string;
  holdingMonths?: number;
  maxAllowableOffer?: number | null;
  isHomestead?: boolean;
  ltvPct?: number;
  interestRatePct?: number;
  monthlyInsurance?: number;
  redemptionProbabilityPct?: number;
}

function blankScenario(): UnderwriteScenario {
  return {
    registrationFunds: "",
    creditedDeposit: "",
    buyersPremium: "",
    sheriffPoundage: "",
    transferTax: "",
    delinquentTaxes: "",
    settlementCosts: "",
    rehabBudget: 25_000,
    targetMargin: 30,
    customValuation: "",
    customOpeningBid: "",
  };
}

function amountText(value: unknown): string {
  if (typeof value !== "string") return "";
  return /^\d*(?:\.\d{0,2})?$/.test(value) ? value : "";
}

function parseUnderwriteScenario(row: unknown): UnderwriteScenario | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const source = row as Record<string, unknown>;
  const scenario = blankScenario();
  for (const field of underwriteFields) scenario[field] = amountText(source[field]);
  if (typeof source.customValuation === "string") {
    scenario.customValuation = amountText(source.customValuation);
  }
  if (typeof source.customOpeningBid === "string") {
    scenario.customOpeningBid = amountText(source.customOpeningBid);
  }
  const rehab = Number(source.rehabBudget);
  const margin = Number(source.targetMargin);
  if (Number.isFinite(rehab) && rehab >= 0 && rehab <= 150_000) scenario.rehabBudget = rehab;
  if (Number.isFinite(margin) && margin >= 10 && margin <= 40) scenario.targetMargin = margin;
  if (source.holdingMonths !== undefined) {
    const holding = Number(source.holdingMonths);
    if (Number.isFinite(holding) && holding >= 1 && holding <= 120) {
      scenario.holdingMonths = Math.round(holding);
    }
  }
  if (source.maxAllowableOffer !== undefined) {
    if (source.maxAllowableOffer === null) {
      scenario.maxAllowableOffer = null;
    } else {
      const mao = Number(source.maxAllowableOffer);
      if (Number.isFinite(mao) && mao >= 0) {
        scenario.maxAllowableOffer = mao;
      }
    }
  }
  if (typeof source.isHomestead === "boolean") {
    scenario.isHomestead = source.isHomestead;
  }
  if (source.ltvPct !== undefined) {
    const ltv = Number(source.ltvPct);
    if (Number.isFinite(ltv) && ltv >= 0 && ltv <= 100) {
      scenario.ltvPct = ltv;
    }
  }
  if (source.interestRatePct !== undefined) {
    const rate = Number(source.interestRatePct);
    if (Number.isFinite(rate) && rate >= 0 && rate <= 25) {
      scenario.interestRatePct = rate;
    }
  }
  if (source.monthlyInsurance !== undefined) {
    const ins = Number(source.monthlyInsurance);
    if (Number.isFinite(ins) && ins >= 0 && ins <= 10_000) {
      scenario.monthlyInsurance = ins;
    }
  }
  if (source.redemptionProbabilityPct !== undefined) {
    const rp = Number(source.redemptionProbabilityPct);
    if (Number.isFinite(rp) && rp >= 0 && rp <= 100) {
      scenario.redemptionProbabilityPct = rp;
    }
  }
  return scenario;
}

function getLocalStorageSafely(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readUnderwriteScenario(listingId: string): UnderwriteScenario | null {
  if (!listingId) return null;
  if (typeof sessionStorage !== "undefined") {
    try {
      const stored = JSON.parse(sessionStorage.getItem(UNDERWRITE_SCENARIO_KEY) || "{}") as Record<string, unknown>;
      const parsed = parseUnderwriteScenario(stored[listingId]);
      if (parsed) return parsed;
    } catch {
      /* fall through to localStorage */
    }
  }
  const local = getLocalStorageSafely();
  if (local) {
    try {
      const raw = local.getItem(`${UNDERWRITE_SCENARIO_LOCAL_PREFIX}${listingId}`);
      if (raw) {
        const parsed = parseUnderwriteScenario(JSON.parse(raw));
        if (parsed) return parsed;
      }
    } catch {
      return null;
    }
  }
  return null;
}

export function listAllUnderwriteScenarios(): Record<string, UnderwriteScenario> {
  const local = getLocalStorageSafely();
  if (!local) return {};
  const out: Record<string, UnderwriteScenario> = {};
  try {
    const keys: string[] = [];
    if (typeof local.length === "number" && typeof local.key === "function") {
      for (let i = 0; i < local.length; i += 1) {
        const key = local.key(i);
        if (typeof key === "string") keys.push(key);
      }
    } else {
      for (const key of Object.keys(local)) keys.push(key);
    }
    for (const key of keys) {
      if (!key.startsWith(UNDERWRITE_SCENARIO_LOCAL_PREFIX)) continue;
      const listingId = key.slice(UNDERWRITE_SCENARIO_LOCAL_PREFIX.length);
      if (!listingId) continue;
      try {
        const raw = local.getItem(key);
        if (!raw) continue;
        const parsed = parseUnderwriteScenario(JSON.parse(raw));
        if (parsed) out[listingId] = parsed;
      } catch {
        /* ignore malformed single-entry payload */
      }
    }
  } catch {
    return {};
  }
  return out;
}

export function writeUnderwriteScenario(
  listingId: string,
  patch: Partial<UnderwriteScenario> | UnderwriteScenario,
): void {
  if (!listingId) return;
  const existing = readUnderwriteScenario(listingId);
  const merged = { ...(existing ?? blankScenario()), ...patch };
  const next = parseUnderwriteScenario(merged) ?? merged;

  if (typeof sessionStorage !== "undefined") {
    try {
      const stored = JSON.parse(sessionStorage.getItem(UNDERWRITE_SCENARIO_KEY) || "{}") as Record<string, UnderwriteScenario>;
      stored[listingId] = next;
      sessionStorage.setItem(UNDERWRITE_SCENARIO_KEY, JSON.stringify(stored));
    } catch {
      /* sessionStorage can be unavailable; the open listing still shows the entered amounts */
    }
  }

  const local = getLocalStorageSafely();
  if (local) {
    try {
      local.setItem(`${UNDERWRITE_SCENARIO_LOCAL_PREFIX}${listingId}`, JSON.stringify(next));
    } catch {
      /* localStorage quota or private-mode failure should not break UI state */
    }
  }

  if (
    typeof window !== "undefined" &&
    typeof window.dispatchEvent === "function" &&
    typeof CustomEvent === "function"
  ) {
    try {
      window.dispatchEvent(
        new CustomEvent(UNDERWRITE_SCENARIO_EVENT, {
          detail: { listingId, scenario: next },
        }),
      );
    } catch {
      /* ignore event dispatch errors */
    }
  }
}

function addLocalWatchlistIdFallback(listingId: string): boolean {
  const normalized = listingId.trim();
  if (!normalized) return false;
  const local = getLocalStorageSafely();
  if (!local) return false;
  const key = "perfectproperty:saved-listings";
  try {
    const parsed = JSON.parse(local.getItem(key) || "[]");
    const current = Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && item.length > 0)
      : [];
    if (current.includes(normalized)) return false;
    local.setItem(key, JSON.stringify([...current, normalized]));
    return true;
  } catch {
    return false;
  }
}

export async function syncScenarioToDealFile(
  listingId: string,
  scenario: UnderwriteScenario,
  options?: { fetchImpl?: typeof fetch | null },
): Promise<{ watchlistAdded: boolean; caseSynced: boolean }> {
  if (typeof listingId !== "string" || !listingId.trim() || !scenario) {
    return { watchlistAdded: false, caseSynced: false };
  }

  const hasMao =
    typeof scenario.maxAllowableOffer === "number" &&
    Number.isFinite(scenario.maxAllowableOffer) &&
    scenario.maxAllowableOffer > 0;
  const customValNum = scenario.customValuation ? Number(scenario.customValuation) : NaN;
  const hasCustomVal = Number.isFinite(customValNum) && customValNum > 0;

  let watchlistAdded = false;
  if (hasMao || hasCustomVal) {
    try {
      const { addLocalWatchlistId } = await import("./watchlist-sync");
      watchlistAdded = addLocalWatchlistId(listingId);
    } catch {
      watchlistAdded = addLocalWatchlistIdFallback(listingId);
    }
  }

  let caseSynced = false;
  const fetchFn = options?.fetchImpl === null ? undefined : (options?.fetchImpl ?? (typeof fetch === "function" ? fetch : undefined));
  if (fetchFn) {
    try {
      const response = await fetchFn("/api/workspace/cases", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          listingId,
          underwriteScenario: {
            maxAllowableOffer: scenario.maxAllowableOffer,
            rehabBudget: scenario.rehabBudget,
            delinquentTaxes: scenario.delinquentTaxes,
            customValuation: scenario.customValuation,
            customOpeningBid: scenario.customOpeningBid,
            targetMargin: scenario.targetMargin,
          },
          thesis: "Auto-synced from Underwriting Simulator",
        }),
      });
      caseSynced = Boolean(response && response.ok);
    } catch {
      caseSynced = false;
    }
  }

  return { watchlistAdded, caseSynced };
}

export function scenarioCashInput(scenario: UnderwriteScenario): Partial<Record<UnderwriteField, number>> {
  const input: Partial<Record<UnderwriteField, number>> = {};
  for (const field of underwriteFields) {
    const raw = scenario[field];
    if (!raw.trim()) continue;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) input[field] = parsed;
  }
  return input;
}
