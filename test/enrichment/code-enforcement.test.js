'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MUNICIPAL_PORTALS,
  resolveMunicipalPortal,
  buildMunicipalQueryUrl,
  isOpenStatus,
  isVacantNotice,
  parseCodeViolationsResponse,
  lookupCodeViolations
} = require('../../server/enrichment/code-enforcement');

test('portal resolver matches supported cities and counties', () => {
  const orlandoByCity = resolveMunicipalPortal({ state: 'FL', city: 'Orlando' });
  assert.equal(orlandoByCity?.source, 'SOCRATA_ORLANDO');

  const orlandoByCounty = resolveMunicipalPortal({ state: 'FL', county: 'Orange County' });
  assert.equal(orlandoByCounty?.source, 'SOCRATA_ORLANDO');

  const chicagoByCity = resolveMunicipalPortal({ state: 'IL', city: 'Chicago' });
  assert.equal(chicagoByCity?.source, 'SOCRATA_CHICAGO');

  const chicagoByCounty = resolveMunicipalPortal({ state: 'IL', county: 'Cook' });
  assert.equal(chicagoByCounty?.source, 'SOCRATA_CHICAGO');

  const nolaByCity = resolveMunicipalPortal({ state: 'LA', city: 'New Orleans' });
  assert.equal(nolaByCity?.source, 'SOCRATA_NEW_ORLEANS');

  const nolaByParish = resolveMunicipalPortal({ state: 'LA', county: 'Orleans Parish' });
  assert.equal(nolaByParish?.source, 'SOCRATA_NEW_ORLEANS');

  const philaByCity = resolveMunicipalPortal({ state: 'PA', city: 'Philadelphia' });
  assert.equal(philaByCity?.source, 'SOCRATA_PHILADELPHIA');

  const philaByCounty = resolveMunicipalPortal({ state: 'PA', county: 'Philadelphia County' });
  assert.equal(philaByCounty?.source, 'SOCRATA_PHILADELPHIA');

  const unsupported = resolveMunicipalPortal({ state: 'WY', city: 'Cheyenne' });
  assert.equal(unsupported, null);
});

test('endpoint query generation for Orlando, Chicago, and New Orleans', () => {
  // Orlando query generation
  const orlandoUrl = buildMunicipalQueryUrl({
    state: 'FL',
    city: 'Orlando',
    address: '421 N Orange Ave'
  });
  assert.ok(orlandoUrl, 'Orlando URL should be generated');
  assert.ok(orlandoUrl.includes('data.cityoforlando.net/resource/5b39-smxs.json'));
  assert.ok(orlandoUrl.includes('case_address'));
  assert.ok(orlandoUrl.includes('421%20N%20ORANGE%20AVE') || orlandoUrl.includes('421+N+ORANGE+AVE'));
  assert.ok(orlandoUrl.includes('$limit=50'));

  // Chicago query generation
  const chicagoUrl = buildMunicipalQueryUrl({
    state: 'IL',
    city: 'Chicago',
    address: '121 N LaSalle St'
  });
  assert.ok(chicagoUrl, 'Chicago URL should be generated');
  assert.ok(chicagoUrl.includes('data.cityofchicago.org/resource/22u3-xenr.json'));
  assert.ok(chicagoUrl.includes('address'));
  assert.ok(chicagoUrl.includes('121%20N%20LASALLE%20ST') || chicagoUrl.includes('121+N+LASALLE+ST'));
  assert.ok(chicagoUrl.includes('$limit=50'));

  // New Orleans query generation
  const nolaUrl = buildMunicipalQueryUrl({
    state: 'LA',
    city: 'New Orleans',
    address: '1300 Perdido St'
  });
  assert.ok(nolaUrl, 'New Orleans URL should be generated');
  assert.ok(nolaUrl.includes('data.nola.gov/resource/8vs5-j6m5.json'));
  assert.ok(nolaUrl.includes('address'));
  assert.ok(nolaUrl.includes('1300%20PERDIDO%20ST') || nolaUrl.includes('1300+PERDIDO+ST'));

  // Parcel ID query generation
  const parcelUrl = buildMunicipalQueryUrl({
    state: 'FL',
    city: 'Orlando',
    parcelId: '29-22-29-0000-00-001'
  });
  assert.ok(parcelUrl.includes('parcel_id'));
  assert.ok(parcelUrl.includes('29-22-29-0000-00-001'));
});

test('parses open vs closed violations and vacancy signals accurately', () => {
  const portal = MUNICIPAL_PORTALS.orlando;
  const mockSocrataData = [
    {
      case_address: '421 N Orange Ave',
      violation_code: 'SEC-301.2',
      violation_description: 'Overgrowth and abandoned debris on exterior lot',
      case_status: 'OPEN',
      opened_date: '2026-06-10',
      last_inspection_date: '2026-07-01'
    },
    {
      case_address: '421 N Orange Ave',
      violation_code: 'SEC-108.1.3',
      violation_description: 'Vacant building notice - structure unsecure and open to entry',
      case_status: 'ACTIVE',
      opened_date: '2026-07-15',
      last_inspection_date: '2026-08-20'
    },
    {
      case_address: '421 N Orange Ave',
      violation_code: 'SEC-202',
      violation_description: 'Exterior paint peeling',
      case_status: 'COMPLIED',
      opened_date: '2026-01-05',
      last_inspection_date: '2026-02-12'
    }
  ];

  const parsed = parseCodeViolationsResponse(mockSocrataData, portal);

  assert.equal(parsed.source, 'SOCRATA_ORLANDO');
  assert.equal(parsed.violationsCount, 3);
  assert.equal(parsed.openViolationsCount, 2);
  assert.equal(parsed.vacantBuildingNotice, true);
  assert.equal(parsed.lastInspectionDate, '2026-08-20');
  assert.equal(parsed.violations.length, 3);
  assert.equal(parsed.violations[0].code, 'SEC-301.2');
  assert.equal(parsed.violations[0].status, 'OPEN');
  assert.equal(parsed.violations[2].status, 'COMPLIED');
});

test('handles Chicago building violations with clean status differentiation', () => {
  const portal = MUNICIPAL_PORTALS.chicago;
  const mockChicagoData = [
    {
      address: '121 N LASALLE ST',
      violation_code: 'CN194019',
      violation_description: 'REPAIR EXTERIOR WALLS',
      violation_status: 'COMPLIED',
      violation_date: '2025-11-04'
    },
    {
      address: '121 N LASALLE ST',
      violation_code: 'CN196019',
      violation_description: 'REPAIR PORCH',
      violation_status: 'PASSED',
      violation_date: '2026-01-15'
    }
  ];

  const parsed = parseCodeViolationsResponse(mockChicagoData, portal);

  assert.equal(parsed.source, 'SOCRATA_CHICAGO');
  assert.equal(parsed.violationsCount, 2);
  assert.equal(parsed.openViolationsCount, 0, 'Both violations are complied/passed');
  assert.equal(parsed.vacantBuildingNotice, false);
  assert.equal(parsed.lastInspectionDate, '2026-01-15');
});

test('lookupCodeViolations end-to-end with injected fetchFn returns structured payload', async () => {
  const fakeRecords = [
    {
      case_address: '1300 Perdido St',
      case_type: 'VBR-DEMO',
      violation_description: 'Order to demolish unsafe structure - emergency board up required',
      case_status: 'OPEN',
      date_opened: '2026-08-01'
    }
  ];

  let calledUrl = '';
  const mockFetch = async (url) => {
    calledUrl = url;
    return {
      ok: true,
      status: 200,
      json: async () => fakeRecords
    };
  };

  const result = await lookupCodeViolations({
    state: 'LA',
    city: 'New Orleans',
    address: '1300 Perdido St',
    fetchFn: mockFetch
  });

  assert.ok(calledUrl.includes('data.nola.gov'));
  assert.equal(result.source, 'SOCRATA_NEW_ORLEANS');
  assert.equal(result.violationsCount, 1);
  assert.equal(result.openViolationsCount, 1);
  assert.equal(result.vacantBuildingNotice, true);
  assert.equal(result.violations[0].code, 'VBR-DEMO');
  assert.ok(result.queriedAt, 'Must include queriedAt timestamp');
});

test('lookupCodeViolations returns graceful fallback on HTTP 500 error', async () => {
  const mockFetch500 = async () => ({
    ok: false,
    status: 500,
    statusText: 'Internal Server Error',
    json: async () => ({ error: 'Database timeout' })
  });

  const result = await lookupCodeViolations({
    state: 'FL',
    city: 'Orlando',
    address: '421 N Orange Ave',
    fetchFn: mockFetch500
  });

  assert.equal(result.source, 'SOCRATA_ORLANDO');
  assert.equal(result.violationsCount, 0);
  assert.equal(result.openViolationsCount, 0);
  assert.equal(result.vacantBuildingNotice, false);
  assert.equal(result.lastInspectionDate, null);
  assert.deepEqual(result.violations, []);
});

test('lookupCodeViolations returns graceful fallback on network error', async () => {
  const mockFetchNetworkError = async () => {
    throw new Error('getaddrinfo ENOTFOUND data.cityofchicago.org');
  };

  const result = await lookupCodeViolations({
    state: 'IL',
    city: 'Chicago',
    address: '121 N LaSalle St',
    fetchFn: mockFetchNetworkError
  });

  assert.equal(result.source, 'SOCRATA_CHICAGO');
  assert.equal(result.violationsCount, 0);
  assert.equal(result.openViolationsCount, 0);
  assert.equal(result.vacantBuildingNotice, false);
  assert.equal(result.lastInspectionDate, null);
  assert.deepEqual(result.violations, []);
});

test('lookupCodeViolations handles timeout gracefully without throwing', async () => {
  const mockFetchTimeout = async () => {
    const error = new Error('The operation was aborted');
    error.name = 'AbortError';
    throw error;
  };

  const result = await lookupCodeViolations({
    state: 'IL',
    city: 'Chicago',
    address: '121 N LaSalle St',
    timeoutMs: 50,
    fetchFn: mockFetchTimeout
  });

  assert.equal(result.source, 'SOCRATA_CHICAGO');
  assert.equal(result.violationsCount, 0);
  assert.equal(result.openViolationsCount, 0);
  assert.equal(result.vacantBuildingNotice, false);
  assert.equal(result.lastInspectionDate, null);
  assert.deepEqual(result.violations, []);
});

test('lookupCodeViolations handles malformed JSON response gracefully', async () => {
  const mockFetchMalformed = async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON at position 0');
    }
  });

  const result = await lookupCodeViolations({
    state: 'FL',
    city: 'Orlando',
    address: '421 N Orange Ave',
    fetchFn: mockFetchMalformed
  });

  assert.equal(result.source, 'SOCRATA_ORLANDO');
  assert.equal(result.violationsCount, 0);
  assert.equal(result.violations.length, 0);
});

test('lookupCodeViolations returns UNSUPPORTED_MUNICIPALITY for unconfigured jurisdictions', async () => {
  let fetchCalled = false;
  const mockFetch = async () => {
    fetchCalled = true;
    return { ok: true, json: async () => [] };
  };

  const result = await lookupCodeViolations({
    state: 'WY',
    county: 'Laramie',
    city: 'Cheyenne',
    address: '100 Lincolnway',
    fetchFn: mockFetch
  });

  assert.equal(fetchCalled, false, 'Fetch should not be called for unsupported municipality');
  assert.deepEqual(result, {
    source: 'UNSUPPORTED_MUNICIPALITY',
    violationsCount: 0,
    openViolationsCount: 0,
    vacantBuildingNotice: false,
    lastInspectionDate: null,
    violations: []
  });
});
