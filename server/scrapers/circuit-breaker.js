/**
 * @file server/scrapers/circuit-breaker.js
 * Circuit breaker pattern and payload validator for external real estate scrapers.
 * Protects database and local data stores against poisoning from 403 Forbidden,
 * Cloudflare challenge walls, CAPTCHAs, or empty/malformed responses.
 */

class ScraperCircuitBreaker {
  /**
   * @param {object} options
   * @param {number} [options.minPayloadBytes=100]
   * @param {number} [options.failureThreshold=3]
   */
  constructor(options = {}) {
    this.minPayloadBytes = options.minPayloadBytes || 100;
    this.failureThreshold = options.failureThreshold || 3;
    this.consecutiveFailures = 0;
    this.state = 'CLOSED'; // 'CLOSED' (healthy), 'OPEN' (tripped), 'HALF-OPEN'
  }

  /**
   * Validates raw HTTP response payload.
   * @param {object} response - { status: number, body: string, headers: object }
   * @returns {object} { isValid: boolean, error: string|null }
   */
  validateResponse(response = {}) {
    const status = response.status || 200;
    const body = String(response.body || '');

    // Check for HTTP error status (403, 429, 500, etc.)
    if (status === 403 || status === 429 || status >= 500) {
      this.trip(`HTTP ${status} received from upstream endpoint.`);
      return {
        isValid: false,
        error: `CIRCUIT_BREAKER_TRIPPED: HTTP ${status} Forbidden/RateLimited/ServerError`
      };
    }

    // Check for Cloudflare / Akamai / Bot challenge signatures
    const botChallengeSignatures = [
      'cf-challenge',
      'turnstile',
      'attention required! | cloudflare',
      'access denied',
      'please verify you are a human',
      'security check'
    ];

    const lower = body.toLowerCase();
    for (const sig of botChallengeSignatures) {
      if (lower.includes(sig)) {
        this.trip(`Bot challenge wall detected: ${sig}`);
        return {
          isValid: false,
          error: `CIRCUIT_BREAKER_TRIPPED: WAF Bot challenge detected (${sig})`
        };
      }
    }

    // Check for zero-byte or empty body
    if (body.trim().length < this.minPayloadBytes) {
      this.trip('Zero-byte or truncated payload.');
      return {
        isValid: false,
        error: `CIRCUIT_BREAKER_TRIPPED: Truncated payload (< ${this.minPayloadBytes} bytes)`
      };
    }

    // Success - reset failures
    this.reset();
    return {
      isValid: true,
      error: null
    };
  }

  trip(reason) {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }

  reset() {
    this.consecutiveFailures = 0;
    this.state = 'CLOSED';
  }

  isOpen() {
    return this.state === 'OPEN';
  }
}

module.exports = {
  ScraperCircuitBreaker
};
