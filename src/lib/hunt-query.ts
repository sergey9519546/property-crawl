export type HuntDraftRule = { field: string; operator: string; value?: string | number };

export type CompileHuntQueryOptions =
  | Date
  | string
  | { now?: Date | string; today?: string };

export const US_STATE_NAME_TO_CODE: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  "district of columbia": "DC",
  "washington dc": "DC",
  "washington d.c.": "DC",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
};

const VALID_STATE_CODES = new Set(Object.values(US_STATE_NAME_TO_CODE));
const STATE_NAMES_DESC = Object.entries(US_STATE_NAME_TO_CODE).sort(
  (a, b) => b[0].length - a[0].length,
);
const AMBIGUOUS_LOWERCASE_STATE_CODES = new Set([
  "in", "or", "me", "hi", "ok", "id",
]);

const NON_COUNTY_PREFIX_WORDS = new Set([
  "in", "within", "for", "of", "the", "a", "an", "any", "all", "and", "or",
  "vacant", "occupied", "unoccupied", "condo", "condos", "condominium",
  "townhome", "townhomes", "townhouse", "townhouses", "house", "houses",
  "home", "homes", "land", "commercial", "duplex", "triplex", "fourplex",
  "manufactured", "mobile", "properties", "property", "listings", "listing",
  "under", "below", "over", "above",
]);

const STOP_WORDS = new Set([
  "a", "an", "the", "in", "on", "at", "of", "for", "to", "from", "by", "with",
  "without", "and", "or", "near", "around", "within", "under", "below", "at",
  "most", "max", "maximum", "bid", "bids", "amount", "properties", "property",
  "listings", "listing", "records", "record", "homes", "home", "real", "estate",
  "auctions", "auction", "sales", "sale", "deals", "deal", "that", "are", "is",
  "be", "have", "has", "any", "all", "show", "find", "get", "me", "my", "next",
  "upcoming", "published", "known", "state",
]);

export function formatIsoDate(dateInput: Date | string = new Date()): string {
  if (typeof dateInput === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateInput.trim())) {
    return dateInput.trim();
  }
  const parsed = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (!Number.isFinite(parsed.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return parsed.toISOString().slice(0, 10);
}

function addUtcDays(isoDate: string, days: number): string {
  const base = new Date(`${isoDate}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function resolveTodayIso(nowOrOptions: CompileHuntQueryOptions): string {
  if (
    nowOrOptions
    && typeof nowOrOptions === "object"
    && !(nowOrOptions instanceof Date)
  ) {
    if (nowOrOptions.today) return formatIsoDate(nowOrOptions.today);
    return formatIsoDate(nowOrOptions.now ?? new Date());
  }
  return formatIsoDate(nowOrOptions);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function compileHuntQuery(
  input: string,
  nowOrOptions: CompileHuntQueryOptions = new Date(),
) {
  const text = input.trim().slice(0, 300);
  const lower = text.toLowerCase();
  const isAllCaps = text.length > 0 && text === text.toUpperCase() && /[A-Z]/.test(text);
  const todayIso = resolveTodayIso(nowOrOptions);
  const rules: HuntDraftRule[] = [];
  const missingDependencies: string[] = [];
  const consumed: [number, number][] = [];

  const add = (rule: HuntDraftRule) => {
    if (!rules.some((item) => JSON.stringify(item) === JSON.stringify(rule))) {
      rules.push(rule);
    }
  };
  const isOverlapping = (start: number, end: number) =>
    consumed.some(([s, e]) => start < e && end > s);
  const markConsumed = (start: number, end: number) => {
    if (end > start) consumed.push([start, end]);
  };

  // 1. Property types (match multi-word phrases like "vacant land" before standalone "vacant").
  const propTypePatterns: [RegExp, string][] = [
    [/\b(?:single[- ]family(?:\s+(?:homes?|houses?|residences?|residential))?|sfr|houses?)\b/gi, "Single Family"],
    [/\b(?:multi[- ]family(?:\s+(?:homes?|houses?|dwellings?|propert(?:y|ies)))?|multifamily|duplex(?:es)?|triplex(?:es)?|fourplex(?:es)?)\b/gi, "Multi Family"],
    [/\b(?:condos?|condominiums?)\b/gi, "Condo"],
    [/\b(?:town[- ]?homes?|town[- ]?houses?)\b/gi, "Town House"],
    [/\b(?:vacant\s+land|vacant\s+lots?|land\s+only|raw\s+land|acreage|lots?|land)\b/gi, "Land"],
    [/\bcommercial(?:\s+(?:propert(?:y|ies)|real\s+estate|buildings?|lots?))?\b/gi, "Commercial"],
    [/\b(?:manufactured(?:\s+homes?)?|mobile\s+homes?|modular(?:\s+homes?)?)\b/gi, "Manufactured"],
  ];
  for (const [pattern, value] of propTypePatterns) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (!isOverlapping(start, end)) {
        add({ field: "propType", operator: "eq", value });
        markConsumed(start, end);
      }
    }
  }

  // 2. Occupancy tokens (after "vacant land" / "vacant lot" are already consumed).
  const occupancyPatterns: [RegExp, string][] = [
    [/\bowner[- ]?occupied\b/gi, "Owner-Occupied"],
    [/\b(?:tenant|renter)[- ]?occupied\b/gi, "Tenant-Occupied"],
    [/\b(?:vacant|unoccupied)\b/gi, "Vacant"],
    [/\boccupied\b/gi, "Occupied"],
  ];
  for (const [pattern, value] of occupancyPatterns) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (!isOverlapping(start, end)) {
        add({ field: "occupancy", operator: "eq", value });
        markConsumed(start, end);
      }
    }
  }

  // 3. Full state names (longest-first so "west virginia" precedes "virginia" and "washington dc" precedes "washington").
  for (const [name, code] of STATE_NAMES_DESC) {
    const pattern = new RegExp(
      `\\b${escapeRegex(name).replace(/\\ /g, "\\s+")}(?:\\b|(?=[\\s,.;!?]|$))`,
      "gi",
    );
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (!isOverlapping(start, end)) {
        add({ field: "state", operator: "eq", value: code });
        markConsumed(start, end);
      }
    }
  }

  // 4. Unambiguous 2-letter US state codes (explicit state label/preposition, comma suffix, or uppercase code).
  for (const match of text.matchAll(/\b(?:(state\s*[:=]?)|(?:in|within|from))\s+([a-z]{2})\b/gi)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const rawCode = match[2];
    const upper = rawCode.toUpperCase();
    const isExplicitStateLabel = Boolean(match[1]);
    if (!VALID_STATE_CODES.has(upper) || isOverlapping(start, end)) continue;
    if (!isExplicitStateLabel && rawCode !== upper && AMBIGUOUS_LOWERCASE_STATE_CODES.has(rawCode.toLowerCase())) {
      continue;
    }
    add({ field: "state", operator: "eq", value: upper });
    markConsumed(start, end);
  }
  for (const match of text.matchAll(/,\s*([a-z]{2})\b/gi)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const upper = match[1].toUpperCase();
    if (!VALID_STATE_CODES.has(upper) || isOverlapping(start, end)) continue;
    add({ field: "state", operator: "eq", value: upper });
    markConsumed(start, end);
  }
  if (!isAllCaps) {
    for (const match of text.matchAll(/\b([A-Z]{2})\b/g)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const code = match[1];
      if (!VALID_STATE_CODES.has(code) || isOverlapping(start, end)) continue;
      if (AMBIGUOUS_LOWERCASE_STATE_CODES.has(code.toLowerCase())) {
        const before = text.slice(Math.max(0, start - 20), start).toLowerCase();
        if (code === "ID" && /\b(?:listing|parcel|property|record|tax|case|folio)\s+$/.test(before)) {
          continue;
        }
        if (code === "OK" || code === "IN" || code === "OR" || code === "ME" || code === "HI") {
          continue;
        }
      }
      add({ field: "state", operator: "eq", value: code });
      markConsumed(start, end);
    }
  }

  // 5. County names ("in/within <Name> County" or bare "<Name> County").
  for (const match of text.matchAll(/\b(?:(?:in|within)\s+)?([a-z][a-z .'-]{1,50}?)\s+county\b/gi)) {
    const matchStart = match.index ?? 0;
    const matchEnd = matchStart + match[0].length;
    if (isOverlapping(matchEnd - 6, matchEnd)) continue;
    const rawWords = match[1].trim().split(/\s+/);
    while (rawWords.length && NON_COUNTY_PREFIX_WORDS.has(rawWords[0].toLowerCase())) {
      rawWords.shift();
    }
    if (!rawWords.length) continue;
    const countyName = rawWords
      .join(" ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
    const nameOffset = match[0].toLowerCase().lastIndexOf(rawWords[0].toLowerCase());
    const consumeStart = nameOffset >= 0 ? matchStart + nameOffset : matchStart;
    add({ field: "county", operator: "eq", value: countyName });
    markConsumed(consumeStart, matchEnd);
  }

  // 6. Opening bid ceiling.
  for (const match of text.matchAll(/\b(?:under|below|at most|less than|up to|max(?:imum)?(?:\s+bid)?(?:\s+of)?)\s*\$?\s*([\d,.]+)\s*([km])?\b/gi)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const base = Number(match[1].replaceAll(",", ""));
    const factor = match[2]?.toLowerCase() === "m" ? 1_000_000 : match[2]?.toLowerCase() === "k" ? 1_000 : 1;
    if (Number.isFinite(base)) {
      add({ field: "openingBid", operator: "lte", value: base * factor });
      markConsumed(start, end);
    }
  }

  // 7. Relative sale date window ("within N days" / "next N days") with today lower bound.
  for (const match of text.matchAll(/\b(?:within(?:\s+the\s+next)?|next)\s+(\d{1,3})\s+days?\b/gi)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const days = Math.min(365, Number(match[1]));
    add({ field: "saleDate", operator: "on_or_after", value: todayIso });
    add({ field: "saleDate", operator: "on_or_before", value: addUtcDays(todayIso, days) });
    markConsumed(start, end);
  }

  // 8. Known opening bid / rescheduled sale keywords.
  for (const match of text.matchAll(/\bopening\s+(?:bid|amount)\s+(?:is\s+)?(?:known|published)\b/gi)) {
    const start = match.index ?? 0;
    add({ field: "openingBid", operator: "known" });
    markConsumed(start, start + match[0].length);
  }
  for (const match of text.matchAll(/\b(?:postponed|rescheduled|date\s+change)\b/gi)) {
    const start = match.index ?? 0;
    add({ field: "saleDate", operator: "known" });
    markConsumed(start, start + match[0].length);
  }

  // 9. Unsupported domain evidence requests.
  const unsupported: [RegExp, string][] = [
    [/\b(?:zoning|subdivide|development potential)\b/gi, "property-specific zoning or development-rights evidence"],
    [/\b(?:flood|wetland|environmental)\b/gi, "property-specific environmental evidence"],
    [/\b(?:lien|title|mortgage|debt)\b/gi, "current title or debt evidence"],
    [/\b(?:fee|premium|closing cost|cash to close)\b/gi, "published sale terms or explicit cost assumptions"],
    [/\b(?:owner phone|email|contact)\b/gi, "authorized contact data"],
  ];
  for (const [pattern, dependency] of unsupported) {
    let matched = false;
    for (const match of lower.matchAll(pattern)) {
      matched = true;
      const start = match.index ?? 0;
      markConsumed(start, start + match[0].length);
    }
    if (matched) missingDependencies.push(dependency);
  }

  // 10. Collect unconsumed meaningful filter terms so nothing is silently dropped.
  const chars = [...text];
  for (const [start, end] of consumed) {
    for (let i = Math.max(0, start); i < Math.min(chars.length, end); i += 1) {
      chars[i] = " ";
    }
  }
  const remaining = chars.join("");
  const unrecognizedTerms: string[] = [];
  const seenUnrecognized = new Set<string>();
  for (const tokenMatch of remaining.matchAll(/[a-z0-9][a-z0-9'-]*/gi)) {
    const rawToken = tokenMatch[0];
    const normalized = rawToken.toLowerCase();
    if (STOP_WORDS.has(normalized)) continue;
    if (!seenUnrecognized.has(normalized)) {
      seenUnrecognized.add(normalized);
      unrecognizedTerms.push(rawToken);
    }
  }

  const warnings: string[] = [];
  if (unrecognizedTerms.length > 0) {
    warnings.push(
      `Unrecognized terms were not converted into filter rules: ${unrecognizedTerms.join(", ")}.`,
    );
  }

  if (!rules.length && !missingDependencies.length && text) {
    missingDependencies.push(
      "a supported state, county, property type, occupancy, published amount, or sale-date criterion",
    );
  }

  return {
    input: text,
    criteria: { mode: "all" as const, rules },
    missingDependencies: [...new Set(missingDependencies)],
    unrecognizedTerms,
    warnings,
  };
}
