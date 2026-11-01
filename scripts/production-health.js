'use strict';

// A slow cold proxy request must be allowed to finish. The old 1.5s probe
// repeatedly cancelled requests whose own upstream deadline was 30 seconds.
async function waitForHealth(url, { timeoutMs = 120000, requestTimeoutMs = 10000, intervalMs = 750,
  fetchImpl = fetch, closing = () => false, onFailure = () => {} } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastFailure = 'not_started';
  while (Date.now() < deadline && !closing()) {
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(Math.max(1, Math.min(requestTimeoutMs, deadline - Date.now()))) });
      const healthy = response.ok;
      if (response.body) await response.body.cancel();
      if (healthy) return true;
      lastFailure = `HTTP ${response.status}`;
    } catch (error) { lastFailure = error.cause?.code || error.name; }
    const remaining = deadline - Date.now();
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, Math.min(intervalMs, remaining)));
  }
  onFailure(lastFailure);
  return false;
}

module.exports = { waitForHealth };
