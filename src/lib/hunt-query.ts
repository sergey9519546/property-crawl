export type HuntDraftRule = { field: string; operator: string; value?: string | number };

const states: Record<string, string> = {
  alabama: "AL", arizona: "AZ", california: "CA", florida: "FL", georgia: "GA", illinois: "IL",
  maryland: "MD", michigan: "MI", nevada: "NV", "new jersey": "NJ", ohio: "OH", pennsylvania: "PA",
  texas: "TX", utah: "UT", "west virginia": "WV",
};

export function compileHuntQuery(input: string, now = new Date()) {
  const text = input.trim().slice(0, 300);
  const lower = text.toLowerCase();
  const rules: HuntDraftRule[] = [];
  const missingDependencies: string[] = [];
  const add = (rule: HuntDraftRule) => { if (!rules.some((item) => JSON.stringify(item) === JSON.stringify(rule))) rules.push(rule); };

  for (const [name, code] of Object.entries(states)) {
    if (new RegExp(`\\b${name.replace(" ", "\\s+")}\\b`, "i").test(text)) add({ field: "state", operator: "eq", value: code });
  }
  const stateCode = text.match(/\b(?:in|state:?|within)\s+([A-Z]{2})\b/);
  if (stateCode) add({ field: "state", operator: "eq", value: stateCode[1].toUpperCase() });
  const county = text.match(/\b(?:in|within)\s+([a-z][a-z .'-]{1,50}?)\s+county\b/i);
  if (county) add({ field: "county", operator: "eq", value: county[1].replace(/\b\w/g, (letter) => letter.toUpperCase()) });
  const ceiling = text.match(/\b(?:under|below|at most|max(?:imum)?(?: bid)?(?: of)?)\s*\$?([\d,.]+)\s*([km])?\b/i);
  if (ceiling) {
    const base = Number(ceiling[1].replaceAll(",", ""));
    const factor = ceiling[2]?.toLowerCase() === "m" ? 1_000_000 : ceiling[2]?.toLowerCase() === "k" ? 1_000 : 1;
    if (Number.isFinite(base)) add({ field: "openingBid", operator: "lte", value: base * factor });
  }
  const within = text.match(/\bwithin\s+(\d{1,3})\s+days?\b/i);
  if (within) {
    const days = Math.min(365, Number(within[1]));
    const date = new Date(now); date.setUTCDate(date.getUTCDate() + days);
    add({ field: "saleDate", operator: "on_or_before", value: date.toISOString().slice(0, 10) });
  }
  if (/\b(?:single[- ]family|house)\b/i.test(text)) add({ field: "propType", operator: "eq", value: "Single Family" });
  if (/\b(?:multi[- ]family|duplex|triplex|fourplex)\b/i.test(text)) add({ field: "propType", operator: "eq", value: "Multi-Family" });
  if (/\b(?:vacant land|vacant lot|land only)\b/i.test(text)) add({ field: "propType", operator: "eq", value: "Land" });
  if (/\bopening (?:bid|amount) (?:is )?(?:known|published)\b/i.test(text)) add({ field: "openingBid", operator: "known" });
  if (/\b(?:postponed|rescheduled|date change)\b/i.test(text)) add({ field: "saleDate", operator: "known" });

  const unsupported: [RegExp, string][] = [
    [/\b(?:zoning|subdivide|development potential)\b/i, "property-specific zoning or development-rights evidence"],
    [/\b(?:flood|wetland|environmental)\b/i, "property-specific environmental evidence"],
    [/\b(?:lien|title|mortgage|debt)\b/i, "current title or debt evidence"],
    [/\b(?:fee|premium|closing cost|cash to close)\b/i, "published sale terms or explicit cost assumptions"],
    [/\b(?:owner phone|email|contact)\b/i, "authorized contact data"],
  ];
  for (const [pattern, dependency] of unsupported) if (pattern.test(lower)) missingDependencies.push(dependency);
  if (!rules.length && !missingDependencies.length && text) missingDependencies.push("a supported state, county, property type, published amount, or sale-date criterion");
  return { input: text, criteria: { mode: "all" as const, rules }, missingDependencies: [...new Set(missingDependencies)] };
}

