/**
 * @file server/scrapers/circuit-breaker.js
 * Circuit breaker pattern and payload validator for external real estate scrapers.
 * Protects database and local data stores against poisoning from 403 Forbidden,
 * Cloudflare challenge walls, CAPTCHAs, or empty/malformed responses.
 */

const BOT_CHALLENGE_SIGNATURES = [
  'cf-challenge',
  'cf-turnstile',
  'turnstile',
  'attention required! | cloudflare',
  'just a moment...',
  'checking your browser',
  'akamai bot manager',
  'access denied',
  'please verify you are a human',
  'verify you are human',
  'security check',
  'captcha'
];

function findBotChallengeSignature(body = '') {
  const lower = String(body).toLowerCase();
  return BOT_CHALLENGE_SIGNATURES.find((signature) => lower.includes(signature)) || null;
}

class ScraperResponseError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'ScraperResponseError';
    this.code = options.code || 'SCRAPER_RESPONSE_REJECTED';
    this.status = options.status ?? null;
    this.haltScraper = Boolean(options.haltScraper);
    this.circuitRecorded = Boolean(options.circuitRecorded);
  }
}

class ScraperCircuitBreaker {
  /**
   * @param {object} options
   * @param {number} [options.minPayloadBytes=1]
   * @param {number} [options.failureThreshold=3]
   */
  constructor(options = {}) {
    this.minPayloadBytes = options.minPayloadBytes ?? 1;
    this.failureThreshold = options.failureThreshold ?? 3;
    this.consecutiveFailures = 0;
    this.failureVersion = 0;
    this.state = 'CLOSED'; // 'CLOSED' (healthy), 'OPEN' (tripped), 'HALF-OPEN'
    this.lastFailureReason = null;
    this.lastFailureAt = null;
  }

  /**
   * Validates raw HTTP response payload.
   * @param {object} response - { status: number, body: string, headers: object }
   * @returns {object} { isValid: boolean, error: string|null }
   */
  validateResponse(response = {}, context = {}) {
    const status = Number(response.status ?? 200);
    const body = String(response.body ?? '');
    const payloadBytes = Buffer.byteLength(body, 'utf8');

    // Check for HTTP error status (403, 429, 500, etc.)
    if (status === 403) {
      this.trip(`HTTP ${status} received from upstream endpoint.`, { immediate: true });
      return {
        isValid: false,
        error: `CIRCUIT_BREAKER_TRIPPED: HTTP ${status} Forbidden`,
        code: 'UPSTREAM_FORBIDDEN',
        haltScraper: true
      };
    }

    // Check for Cloudflare / Akamai / Bot challenge signatures
    const challengeSignature = findBotChallengeSignature(body);
    if (challengeSignature) {
      this.trip(`Bot challenge wall detected: ${challengeSignature}`, { immediate: true });
      return {
        isValid: false,
        error: `CIRCUIT_BREAKER_TRIPPED: WAF bot challenge detected (${challengeSignature})`,
        code: 'UPSTREAM_BOT_CHALLENGE',
        haltScraper: true
      };
    }

    // Check for zero-byte or empty body
    if (payloadBytes === 0 || body.trim().length === 0) {
      this.trip('Zero-byte or whitespace-only payload.', { immediate: true });
      return {
        isValid: false,
        error: 'CIRCUIT_BREAKER_TRIPPED: Empty upstream payload',
        code: 'UPSTREAM_EMPTY_PAYLOAD',
        haltScraper: true
      };
    }

    if (payloadBytes < this.minPayloadBytes) {
      this.trip(`Truncated payload (${payloadBytes} bytes).`);
      return {
        isValid: false,
        error: `CIRCUIT_BREAKER_REJECTED: Truncated payload (< ${this.minPayloadBytes} bytes)`,
        code: 'UPSTREAM_TRUNCATED_PAYLOAD',
        haltScraper: false
      };
    }

    if (!Number.isInteger(status) || status < 200 || status >= 400) {
      this.trip(`HTTP ${status} received from upstream endpoint.`);
      return {
        isValid: false,
        error: `CIRCUIT_BREAKER_REJECTED: HTTP ${status}`,
        code: status === 429 ? 'UPSTREAM_RATE_LIMITED' : 'UPSTREAM_HTTP_ERROR',
        haltScraper: this.isOpen()
      };
    }

    // A slower success from an already in-flight request must not erase a
    // failure (especially an immediate 403/challenge trip) observed after
    // that request started. Only a fresh success may reset a closed breaker.
    const requestGeneration = context.requestGeneration;
    if (this.isOpen()) {
      return {
        isValid: false,
        error: 'CIRCUIT_BREAKER_TRIPPED: Source circuit opened while request was in flight',
        code: 'SCRAPER_CIRCUIT_OPEN',
        haltScraper: true
      };
    }
    if (requestGeneration === undefined || requestGeneration === this.failureVersion) {
      this.reset();
    }
    return {
      isValid: true,
      error: null
    };
  }

  trip(reason, options = {}) {
    this.lastFailureReason = String(reason || 'Unknown scraper failure');
    this.lastFailureAt = new Date().toISOString();
    this.consecutiveFailures++;
    this.failureVersion++;
    if (options.immediate || this.consecutiveFailures >= this.failureThreshold) {
      this.state = 'OPEN';
    }
  }

  reset() {
    this.consecutiveFailures = 0;
    this.state = 'CLOSED';
    this.lastFailureReason = null;
    this.lastFailureAt = null;
  }

  isOpen() {
    return this.state === 'OPEN';
  }
}

module.exports = {
  BOT_CHALLENGE_SIGNATURES,
  ScraperCircuitBreaker,
  ScraperResponseError,
  findBotChallengeSignature
};
