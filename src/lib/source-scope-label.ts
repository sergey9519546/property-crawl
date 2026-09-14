type ScopeRecord = Record<string, unknown>;

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function identifier(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return text(value);
}

function strings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => text(item) ? [text(item)!] : []);
}

function record(value: unknown): ScopeRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as ScopeRecord
    : null;
}

function countyLabel(county: string) {
  return /\bcounty\b/i.test(county) ? county : `${county} County`;
}

/**
 * Presents only the jurisdiction explicitly recorded for an operational run.
 * It deliberately does not infer statewide or national coverage from a source.
 */
export function formatSourceScope(scope: unknown) {
  const configured = text(scope);
  if (configured) return `Scope: ${configured}`;
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
    return "Scope not recorded";
  }

  const values = scope as ScopeRecord;
  // The run ledger stores publisher search constraints under filters. Prefer
  // those constraints because they describe what this run actually requested.
  const filters = record(values.filters);
  const scoped = filters || values;
  const state = text(scoped.state) || text(scoped.stateCode) || text(values.state) || text(values.stateCode);
  const county = text(scoped.countyName) || text(scoped.county) || text(values.countyName) || text(values.county);
  const countyId = identifier(scoped.countyId) || identifier(scoped.countyID)
    || identifier(values.countyId) || identifier(values.countyID);
  const scopedStates = strings(scoped.states).length ? strings(scoped.states) : strings(scoped.stateCodes);
  const states = scopedStates.length ? scopedStates : (strings(values.states).length ? strings(values.states) : strings(values.stateCodes));

  if (county) {
    const place = countyLabel(county);
    return state ? `${state} · ${place}` : `County: ${place}`;
  }
  if (countyId) {
    return state ? `${state} · county ID ${countyId}` : `County ID ${countyId}`;
  }
  if (states.length) {
    return states.length === 1 ? `State: ${states[0]}` : `States: ${states.join(", ")}`;
  }
  if (state) return `State: ${state}`;

  const region = text(values.region);
  if (region) return `Region: ${region}`;
  return "Scope details not recorded";
}

/**
 * Keeps multi-jurisdiction scopes readable in compact UI while leaving the
 * complete recorded scope available through formatSourceScope.
 */
export function formatSourceScopeSummary(scope: unknown) {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) {
    return formatSourceScope(scope);
  }

  const values = scope as ScopeRecord;
  const filters = record(values.filters);
  const scoped = filters || values;
  const scopedStates = strings(scoped.states).length
    ? strings(scoped.states)
    : strings(scoped.stateCodes);
  const states = scopedStates.length
    ? scopedStates
    : (strings(values.states).length
      ? strings(values.states)
      : strings(values.stateCodes));

  if (states.length > 1) {
    return `Scope: ${states.length} recorded jurisdictions`;
  }
  return formatSourceScope(scope);
}
