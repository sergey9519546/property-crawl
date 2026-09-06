'use strict';

const { performance } = require('node:perf_hooks');

const RECORDS = Number(process.env.DISCOVERY_BENCH_RECORDS || 100000);
const READERS = Number(process.env.DISCOVERY_BENCH_READERS || 10);
const ITERATIONS = Number(process.env.DISCOVERY_BENCH_ITERATIONS || 20);

function makeRecords(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `bench-${index}`,
    state: ['CA', 'FL', 'TX', 'OH'][index % 4],
    source: index % 3 ? 'servicelink' : 'hud',
    city: `City ${index % 500}`,
    address: `${index} Main Street`,
    latitude: 25 + (index % 3000) / 100,
    longitude: -120 + (index % 3000) / 100,
    openingBid: 50000 + (index % 1000) * 100,
  }));
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] || 0;
}

function memorySearch(records, query) {
  const q = String(query.q || '').toLowerCase();
  return records.filter((record) => (!query.state || record.state === query.state)
    && (!q || `${record.address} ${record.city}`.toLowerCase().includes(q))).slice(0, 50);
}

async function runMemoryBenchmark() {
  const records = makeRecords(RECORDS);
  const samples = [];
  for (let round = 0; round < ITERATIONS; round += 1) {
    const started = performance.now();
    await Promise.all(Array.from({ length: READERS }, (_, reader) => Promise.resolve(
      memorySearch(records, { state: ['CA', 'FL', 'TX', 'OH'][reader % 4], q: 'main' }),
    )));
    samples.push(performance.now() - started);
  }
  return {
    mode: 'memory-microbenchmark',
    records: RECORDS,
    concurrentReaders: READERS,
    iterations: ITERATIONS,
    p95Ms: percentile(samples, 0.95),
    targetMs: 1000,
    hardware: `${process.platform}/${process.arch}/${process.version}`,
    note: 'This does not measure PostgreSQL, PostGIS, network, or API overhead.',
  };
}

async function main() {
  if (process.env.DISCOVERY_BENCH_URL) {
    const base = process.env.DISCOVERY_BENCH_URL.replace(/\/$/, '');
    const samples = [];
    const mapSamples = [];
    const fetchMany = async (path, output) => {
      const started = performance.now();
      await Promise.all(Array.from({ length: READERS }, () => fetch(`${base}${path}`)));
      output.push(performance.now() - started);
    };
    for (let round = 0; round < ITERATIONS; round += 1) {
      await fetchMany('/api/listings?limit=50&facets=state,source', samples);
      await fetchMany('/api/listings/map?limit=200&bbox=-125,24,-66,50', mapSamples);
    }
    console.log(JSON.stringify({ mode: 'live-api', records: RECORDS, concurrentReaders: READERS, iterations: ITERATIONS, searchP95Ms: percentile(samples, 0.95), mapP95Ms: percentile(mapSamples, 0.95), searchTargetMs: 1000, mapTargetMs: 1500, hardware: `${process.platform}/${process.arch}/${process.version}`, note: 'API timings include network/server overhead; verify database row count separately.' }, null, 2));
    return;
  }
  console.log(JSON.stringify(await runMemoryBenchmark(), null, 2));
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { makeRecords, memorySearch, percentile, runMemoryBenchmark };
