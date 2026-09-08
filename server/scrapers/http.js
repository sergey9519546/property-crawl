const {
  ScraperCircuitBreaker,
  ScraperResponseError
} = require('./circuit-breaker');

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const RETRYABLE_TRANSPORT_CODES = new Set(['EAI_AGAIN','ECONNRESET','ECONNREFUSED','ENETDOWN','ENETUNREACH','EHOSTUNREACH','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_SOCKET']);
function safeTransportDetails(error, url, timedOut = false) {
  let code=null;const queue=[error];
  for(let visited=0;queue.length&&visited<12;visited++){const current=queue.shift();if(!current)continue;const candidate=String(current.code||'').toUpperCase();if(/^[A-Z][A-Z0-9_]{1,63}$/.test(candidate)){code=candidate;break;}if(current.cause)queue.push(current.cause);if(Array.isArray(current.errors))queue.push(...current.errors);}
  let hostname='upstream';try{hostname=new URL(String(url)).hostname||hostname;}catch{}
  const transportCode=timedOut?'UPSTREAM_TIMEOUT':code||'UPSTREAM_TRANSPORT_ERROR';
  return {hostname,transportCode,retryable:timedOut||RETRYABLE_TRANSPORT_CODES.has(transportCode),message:`${timedOut?'Request timed out':'Upstream transport failed'} (${transportCode}) for host ${hostname}; retryable=${timedOut||RETRYABLE_TRANSPORT_CODES.has(transportCode)}`};
}
const DEFAULT_JITTER_MIN_MS = 250;
const DEFAULT_JITTER_MAX_MS = 750;

function normalizeRequestTimeout(timeoutMs) {
  const parsed = Number(timeoutMs);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_REQUEST_TIMEOUT_MS;
  return Math.min(Math.floor(parsed), DEFAULT_REQUEST_TIMEOUT_MS);
}

function randomJitterMs(options = {}) {
  const minMs = Number.isFinite(options.minMs) ? Math.max(0, Math.floor(options.minMs)) : DEFAULT_JITTER_MIN_MS;
  const maxCandidate = Number.isFinite(options.maxMs) ? Math.max(0, Math.floor(options.maxMs)) : DEFAULT_JITTER_MAX_MS;
  const maxMs = Math.max(minMs, maxCandidate);
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const sample = Math.min(1, Math.max(0, Number(random()) || 0));
  return Math.min(maxMs, Math.floor(minMs + sample * (maxMs - minMs + 1)));
}

async function crawlJitter(options = {}) {
  const baseMs = Number.isFinite(options.baseMs) ? Math.max(0, Math.floor(options.baseMs)) : 0;
  const delayMs = baseMs + randomJitterMs(options);
  const sleep = typeof options.sleep === 'function'
    ? options.sleep
    : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  await sleep(delayMs);
  return delayMs;
}

async function mapWithConcurrency(items, concurrency, worker) {
  const list = Array.isArray(items) ? items : [];
  const parsedConcurrency = Number(concurrency);
  const limit = Number.isFinite(parsedConcurrency) && parsedConcurrency > 0
    ? Math.max(1, Math.floor(parsedConcurrency))
    : 1;
  const results = new Array(list.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < list.length) {
      const index = nextIndex++;
      try {
        results[index] = { status: 'fulfilled', value: await worker(list[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }

  const workerCount = Math.min(list.length, limit);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

async function fetchTextWithPolicy(url, options = {}) {
  const {
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    circuitBreaker = new ScraperCircuitBreaker(),
    ...requestOptions
  } = options;

  if (typeof fetchImpl !== 'function') {
    throw new TypeError('A fetch implementation is required');
  }
  if (circuitBreaker.isOpen()) {
    throw new ScraperResponseError('Scraper halted: circuit breaker is OPEN', {
      code: 'SCRAPER_CIRCUIT_OPEN',
      haltScraper: true
    });
  }
  const requestGeneration = circuitBreaker.failureVersion;

  const controller = new AbortController();
  const externalSignal = requestOptions.signal;
  delete requestOptions.signal;
  const forwardAbort = () => controller.abort(externalSignal.reason);
  if (externalSignal) {
    if (externalSignal.aborted) forwardAbort();
    else externalSignal.addEventListener('abort', forwardAbort, { once: true });
  }

  const effectiveTimeoutMs = normalizeRequestTimeout(timeoutMs);
  const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);

  try {
    const response = await fetchImpl(url, { ...requestOptions, signal: controller.signal });
    const body = await response.text();
    const validation = circuitBreaker.validateResponse({
      status: response.status,
      body,
      headers: response.headers
    }, { requestGeneration });

    if (!validation.isValid) {
      throw new ScraperResponseError(`${validation.error} for ${url}`, {
        code: validation.code,
        status: response.status,
        haltScraper: validation.haltScraper,
        circuitRecorded: true
      });
    }
    return body;
  } catch (error) {
    if (error instanceof ScraperResponseError) throw error;

    const timedOut = controller.signal.aborted && !(externalSignal && externalSignal.aborted);
    const detail=safeTransportDetails(error,url,timedOut);
    const wrapped = new ScraperResponseError(
      detail.message,
      {
        code: timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_TRANSPORT_ERROR',
        haltScraper: false,
        circuitRecorded: true
      }
    );
    wrapped.transportCode=detail.transportCode;wrapped.hostname=detail.hostname;wrapped.retryable=detail.retryable;
    circuitBreaker.trip(wrapped.message);
    throw wrapped;
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', forwardAbort);
  }
}

async function fetchJsonWithPolicy(url, options = {}) {
  const text = await fetchTextWithPolicy(url, options);
  try {
    return JSON.parse(text);
  } catch (error) {
    const breaker = options.circuitBreaker;
    if (breaker) breaker.trip(`Invalid JSON payload: ${error.message}`);
    throw new ScraperResponseError(`Invalid JSON payload from ${url}: ${error.message}`, {
      code: 'UPSTREAM_INVALID_JSON',
      haltScraper: Boolean(breaker && breaker.isOpen()),
      circuitRecorded: Boolean(breaker)
    });
  }
}

module.exports = {
  DEFAULT_JITTER_MAX_MS,
  DEFAULT_JITTER_MIN_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  crawlJitter,
  fetchJsonWithPolicy,
  fetchTextWithPolicy,
  safeTransportDetails,
  mapWithConcurrency,
  normalizeRequestTimeout,
  randomJitterMs
};
