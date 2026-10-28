export const UNDERWRITE_SCENARIO_KEY = "pp_underwrite_scenario";

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

export function readUnderwriteScenario(listingId: string): UnderwriteScenario | null {
  if (typeof sessionStorage === "undefined" || !listingId) return null;
  try {
    const stored = JSON.parse(sessionStorage.getItem(UNDERWRITE_SCENARIO_KEY) || "{}") as Record<string, unknown>;
    const row = stored[listingId];
    if (!row || typeof row !== "object") return null;
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
    return scenario;
  } catch {
    return null;
  }
}

export function writeUnderwriteScenario(listingId: string, scenario: UnderwriteScenario): void {
  if (typeof sessionStorage === "undefined" || !listingId) return;
  try {
    const stored = JSON.parse(sessionStorage.getItem(UNDERWRITE_SCENARIO_KEY) || "{}") as Record<string, UnderwriteScenario>;
    stored[listingId] = scenario;
    sessionStorage.setItem(UNDERWRITE_SCENARIO_KEY, JSON.stringify(stored));
  } catch {
    /* sessionStorage can be unavailable; the open listing still shows the entered amounts */
  }
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
