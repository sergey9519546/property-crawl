/**
 * latest-request gate
 *
 * Polling views issue overlapping requests: an interval poll can be in flight
 * when the operator triggers a refresh, and the two can resolve in either
 * order. Whichever resolves last wins unless you say otherwise — which is how a
 * slow poll overwrites fresher data with stale data and leaves nothing on
 * screen to indicate it happened.
 *
 * This is deliberately a tiny standalone module rather than logic inlined in
 * the component. There is no DOM test runner in this project, so a guard that
 * lives inside a `.tsx` can only be asserted by reading its source, which proves
 * very little. Extracted, the ordering rule is a pure function that can be
 * executed and actually made to fail.
 *
 * Usage:
 *
 *     const gate = createRequestGate();
 *     const token = gate.begin();
 *     const data = await load();
 *     if (!gate.isCurrent(token)) return;   // a newer request has overtaken us
 *     render(data);
 */
export interface RequestGate {
  /** Start a request; returns the token identifying it. */
  begin(): number;
  /** True while `token` is still the most recently started request. */
  isCurrent(token: number): boolean;
}

export function createRequestGate(): RequestGate {
  let latest = 0;
  return {
    begin(): number {
      latest += 1;
      return latest;
    },
    isCurrent(token: number): boolean {
      return token === latest;
    },
  };
}
