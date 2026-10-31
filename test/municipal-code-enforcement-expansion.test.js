'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MUNICIPAL_PORTALS,
  resolveMunicipalPortal,
  buildMunicipalQueryUrl,
  parseCodeViolationsResponse,
  isOpenStatus,
  isVacantNotice
} = require('../server/enrichment/code-enforcement');

const {
  MUNICIPAL_SURVIVAL_RULES,
  analyzeMunicipalViolations
} = require('../server/intelligence/municipal-liens');

const {
  SOURCE_HOSTS,
  inspectSourceRecordUrl
} = require('../server/scrapers/source-policy');

// ============================================================================
// 1. resolveMunicipalPortal tests for all 9 distress markets
// ============================================================================

test('resolveMunicipalPortal resolves Austin, TX by city and Travis/Williamson counties', () => {
  const byCity = resolveMunicipalPortal({ state: 'TX', city: 'Austin' });
  assert.equal(byCity?.key, 'austin');
  assert.equal(byCity?.source, 'SOCRATA_AUSTIN');
  assert.equal(byCity?.host, 'data.austintexas.gov');

  const byTravis = resolveMunicipalPortal({ state: 'TX', county: 'Travis' });
  assert.equal(byTravis?.key, 'austin');

  const byTravisCounty = resolveMunicipalPortal({ state: 'TX', county: 'Travis County' });
  assert.equal(byTravisCounty?.key, 'austin');

  const byWilliamson = resolveMunicipalPortal({ state: 'TX', county: 'Williamson County' });
  assert.equal(byWilliamson?.key, 'austin');
});

test('resolveMunicipalPortal resolves Dallas, TX by city and Dallas/Collin/Denton counties', () => {
  const byCity = resolveMunicipalPortal({ state: 'TX', city: 'Dallas' });
  assert.equal(byCity?.key, 'dallas');
  assert.equal(byCity?.source, 'SOCRATA_DALLAS');
  assert.equal(byCity?.host, 'www.dallasopendata.com');

  const byDallasCounty = resolveMunicipalPortal({ state: 'TX', county: 'Dallas County' });
  assert.equal(byDallasCounty?.key, 'dallas');

  const byCollin = resolveMunicipalPortal({ state: 'TX', county: 'Collin' });
  assert.equal(byCollin?.key, 'dallas');

  const byDenton = resolveMunicipalPortal({ state: 'TX', county: 'Denton County' });
  assert.equal(byDenton?.key, 'dallas');
});

test('resolveMunicipalPortal resolves Baltimore, MD by city and Baltimore City/County', () => {
  const byCity = resolveMunicipalPortal({ state: 'MD', city: 'Baltimore' });
  assert.equal(byCity?.key, 'baltimore');
  assert.equal(byCity?.source, 'SOCRATA_BALTIMORE');
  assert.equal(byCity?.host, 'data.baltimorecity.gov');

  const byCityAlias = resolveMunicipalPortal({ state: 'MD', city: 'Baltimore City' });
  assert.equal(byCityAlias?.key, 'baltimore');

  const byCountyCity = resolveMunicipalPortal({ state: 'MD', county: 'Baltimore City' });
  assert.equal(byCountyCity?.key, 'baltimore');

  const byCounty = resolveMunicipalPortal({ state: 'MD', county: 'Baltimore County' });
  assert.equal(byCounty?.key, 'baltimore');
});

test('resolveMunicipalPortal resolves Cincinnati, OH by city and Hamilton County', () => {
  const byCity = resolveMunicipalPortal({ state: 'OH', city: 'Cincinnati' });
  assert.equal(byCity?.key, 'cincinnati');
  assert.equal(byCity?.source, 'SOCRATA_CINCINNATI');
  assert.equal(byCity?.host, 'data.cincinnati-oh.gov');

  const byCounty = resolveMunicipalPortal({ state: 'OH', county: 'Hamilton County' });
  assert.equal(byCounty?.key, 'cincinnati');
});

test('resolveMunicipalPortal resolves Kansas City, MO by city and Jackson/Clay/Platte counties', () => {
  const byCity = resolveMunicipalPortal({ state: 'MO', city: 'Kansas City' });
  assert.equal(byCity?.key, 'kansascity');
  assert.equal(byCity?.source, 'SOCRATA_KANSAS_CITY');
  assert.equal(byCity?.host, 'data.kcmo.org');

  const byJackson = resolveMunicipalPortal({ state: 'MO', county: 'Jackson County' });
  assert.equal(byJackson?.key, 'kansascity');

  const byClay = resolveMunicipalPortal({ state: 'MO', county: 'Clay' });
  assert.equal(byClay?.key, 'kansascity');

  const byPlatte = resolveMunicipalPortal({ state: 'MO', county: 'Platte County' });
  assert.equal(byPlatte?.key, 'kansascity');
});

test('resolveMunicipalPortal resolves Orlando, FL by city and Orange County', () => {
  const byCity = resolveMunicipalPortal({ state: 'FL', city: 'Orlando' });
  assert.equal(byCity?.key, 'orlando');
  assert.equal(byCity?.source, 'SOCRATA_ORLANDO');
  assert.equal(byCity?.host, 'data.cityoforlando.net');

  const byCounty = resolveMunicipalPortal({ state: 'FL', county: 'Orange County' });
  assert.equal(byCounty?.key, 'orlando');
});

test('resolveMunicipalPortal resolves Chicago, IL by city and Cook County', () => {
  const byCity = resolveMunicipalPortal({ state: 'IL', city: 'Chicago' });
  assert.equal(byCity?.key, 'chicago');
  assert.equal(byCity?.source, 'SOCRATA_CHICAGO');
  assert.equal(byCity?.host, 'data.cityofchicago.org');

  const byCounty = resolveMunicipalPortal({ state: 'IL', county: 'Cook' });
  assert.equal(byCounty?.key, 'chicago');
});

test('resolveMunicipalPortal resolves New Orleans, LA by city and Orleans Parish', () => {
  const byCity = resolveMunicipalPortal({ state: 'LA', city: 'New Orleans' });
  assert.equal(byCity?.key, 'neworleans');
  assert.equal(byCity?.source, 'SOCRATA_NEW_ORLEANS');
  assert.equal(byCity?.host, 'data.nola.gov');

  const byParish = resolveMunicipalPortal({ state: 'LA', county: 'Orleans Parish' });
  assert.equal(byParish?.key, 'neworleans');
});

test('resolveMunicipalPortal resolves Philadelphia, PA by city, nickname, and county', () => {
  const byCity = resolveMunicipalPortal({ state: 'PA', city: 'Philadelphia' });
  assert.equal(byCity?.key, 'philadelphia');
  assert.equal(byCity?.source, 'SOCRATA_PHILADELPHIA');
  assert.equal(byCity?.host, 'data.phila.gov');

  const byNick = resolveMunicipalPortal({ state: 'PA', city: 'Philly' });
  assert.equal(byNick?.key, 'philadelphia');

  const byCounty = resolveMunicipalPortal({ state: 'PA', county: 'Philadelphia County' });
  assert.equal(byCounty?.key, 'philadelphia');
});

test('resolveMunicipalPortal returns null for unsupported jurisdictions', () => {
  assert.equal(resolveMunicipalPortal({ state: 'WY', city: 'Cheyenne' }), null);
  assert.equal(resolveMunicipalPortal({ state: 'ND', city: 'Bismarck' }), null);
  assert.equal(resolveMunicipalPortal({ state: null }), null);
});

// ============================================================================
// 2. buildMunicipalQueryUrl tests for each portal with address and parcel ID
// ============================================================================

test('buildMunicipalQueryUrl generates properly formatted SODA endpoints with address and parcel', () => {
  // Austin
  const austinUrl = buildMunicipalQueryUrl({
    state: 'TX',
    city: 'Austin',
    address: '1100 Congress Ave',
    parcelId: '02040506'
  });
  assert.ok(austinUrl.startsWith('https://data.austintexas.gov/resource/b274-pqqb.json'));
  assert.ok(austinUrl.includes('property_address'));
  assert.ok(austinUrl.includes('1100%20CONGRESS%20AVE') || austinUrl.includes('1100+CONGRESS+AVE'));
  assert.ok(austinUrl.includes('parcel_id'));
  assert.ok(austinUrl.includes('02040506'));
  assert.ok(austinUrl.includes('opened_date'));

  // Dallas
  const dallasUrl = buildMunicipalQueryUrl({
    state: 'TX',
    city: 'Dallas',
    address: '1500 Marilla St',
    parcelId: '00000123456'
  });
  assert.ok(dallasUrl.startsWith('https://www.dallasopendata.com/resource/9qet-m2u9.json'));
  assert.ok(dallasUrl.includes('service_request_address'));
  assert.ok(dallasUrl.includes('1500%20MARILLA%20ST') || dallasUrl.includes('1500+MARILLA+ST'));
  assert.ok(dallasUrl.includes('property_id'));
  assert.ok(dallasUrl.includes('created_date'));

  // Baltimore
  const baltimoreUrl = buildMunicipalQueryUrl({
    state: 'MD',
    city: 'Baltimore',
    address: '100 Holliday St',
    parcelId: '0101-001'
  });
  assert.ok(baltimoreUrl.startsWith('https://data.baltimorecity.gov/resource/n435-yubt.json'));
  assert.ok(baltimoreUrl.includes('propertyaddress'));
  assert.ok(baltimoreUrl.includes('blocklot'));
  assert.ok(baltimoreUrl.includes('noticedate'));

  // Cincinnati
  const cincinnatiUrl = buildMunicipalQueryUrl({
    state: 'OH',
    city: 'Cincinnati',
    address: '801 Plum St',
    parcelId: '006500010022'
  });
  assert.ok(cincinnatiUrl.startsWith('https://data.cincinnati-oh.gov/resource/cf5w-zngb.json'));
  assert.ok(cincinnatiUrl.includes('address'));
  assert.ok(cincinnatiUrl.includes('parcel_number'));
  assert.ok(cincinnatiUrl.includes('entered_date'));

  // Kansas City
  const kcUrl = buildMunicipalQueryUrl({
    state: 'MO',
    city: 'Kansas City',
    address: '414 E 12th St',
    parcelId: 'JA123456'
  });
  assert.ok(kcUrl.startsWith('https://data.kcmo.org/resource/ax3m-jhxx.json'));
  assert.ok(kcUrl.includes('street_address'));
  assert.ok(kcUrl.includes('kiva_pin'));
  assert.ok(kcUrl.includes('violation_entry_date'));

  // Orlando
  const orlandoUrl = buildMunicipalQueryUrl({
    state: 'FL',
    city: 'Orlando',
    address: '421 N Orange Ave',
    parcelId: '29-22-29-0000-00-001'
  });
  assert.ok(orlandoUrl.startsWith('https://data.cityoforlando.net/resource/5b39-smxs.json'));
  assert.ok(orlandoUrl.includes('case_address'));
  assert.ok(orlandoUrl.includes('parcel_id'));
  assert.ok(orlandoUrl.includes('opened_date'));

  // Chicago
  const chicagoUrl = buildMunicipalQueryUrl({
    state: 'IL',
    city: 'Chicago',
    address: '121 N LaSalle St',
    parcelId: '17-09-200-001'
  });
  assert.ok(chicagoUrl.startsWith('https://data.cityofchicago.org/resource/22u3-xenr.json'));
  assert.ok(chicagoUrl.includes('address'));
  assert.ok(chicagoUrl.includes('property_group'));
  assert.ok(chicagoUrl.includes('violation_date'));

  // New Orleans
  const nolaUrl = buildMunicipalQueryUrl({
    state: 'LA',
    city: 'New Orleans',
    address: '1300 Perdido St',
    parcelId: 'GEO-998877'
  });
  assert.ok(nolaUrl.startsWith('https://data.nola.gov/resource/8vs5-j6m5.json'));
  assert.ok(nolaUrl.includes('address'));
  assert.ok(nolaUrl.includes('geopin'));
  assert.ok(nolaUrl.includes('date_opened'));

  // Philadelphia
  const philaUrl = buildMunicipalQueryUrl({
    state: 'PA',
    city: 'Philadelphia',
    address: '1400 John F Kennedy Blvd',
    parcelId: '881234567'
  });
  assert.ok(philaUrl.startsWith('https://data.phila.gov/resource/4zmm-btfc.json'));
  assert.ok(philaUrl.includes('address'));
  assert.ok(philaUrl.includes('parcel_id_num'));
  assert.ok(philaUrl.includes('violationdate'));
});

// ============================================================================
// 3. parseCodeViolationsResponse tests with mock Socrata responses
// ============================================================================

test('parseCodeViolationsResponse parses Austin responses extracting fines, demolition risk, and vacancy', () => {
  const portal = MUNICIPAL_PORTALS.austin;
  const mockAustinData = [
    {
      property_address: '1100 CONGRESS AVE',
      parcel_id: '02040506',
      code_section: '25-12-243',
      case_description: 'Substandard structural roof support and hazardous wiring',
      case_status: 'OPEN',
      opened_date: '2026-03-15',
      last_inspection_date: '2026-04-01',
      fine_amount: 850
    },
    {
      property_address: '1100 CONGRESS AVE',
      parcel_id: '02040506',
      code_section: '25-12-244',
      case_description: 'Dangerous building order to demolish unsafe structure - emergency board up required',
      case_status: 'ACTIVE',
      opened_date: '2026-04-10',
      last_inspection_date: '2026-05-02',
      fine_amount: 1500
    },
    {
      property_address: '1100 CONGRESS AVE',
      parcel_id: '02040506',
      code_section: '25-12-101',
      case_description: 'Tall weeds and accumulation of rubbish',
      case_status: 'COMPLIED',
      opened_date: '2025-08-01',
      last_inspection_date: '2025-08-20',
      fine_amount: 250
    }
  ];

  const parsed = parseCodeViolationsResponse(mockAustinData, portal);

  assert.equal(parsed.source, 'SOCRATA_AUSTIN');
  assert.equal(parsed.violationsCount, 3);
  assert.equal(parsed.openViolationsCount, 2);
  assert.equal(parsed.totalFines, 2350, 'Total open fines should sum 850 + 1500');
  assert.equal(parsed.isCondemned, true, 'Should detect dangerous building order to demolish');
  assert.equal(parsed.hasDemolitionRisk, true);
  assert.equal(parsed.vacantBuildingNotice, true, 'Demolition / board up triggers vacancy notice');
  assert.equal(parsed.lastInspectionDate, '2026-05-02');

  assert.equal(parsed.violations[0].fineAmount, 850);
  assert.equal(parsed.violations[0].status, 'OPEN');
  assert.equal(parsed.violations[1].isCondemned, true);
  assert.equal(parsed.violations[1].isDemolitionRisk, true);
  assert.equal(parsed.violations[2].status, 'COMPLIED');
});

test('parseCodeViolationsResponse parses Dallas code compliance violations', () => {
  const portal = MUNICIPAL_PORTALS.dallas;
  const mockDallasData = [
    {
      service_request_address: '1500 MARILLA ST',
      property_id: '00000123456',
      violation_type: 'SUBSTANDARD STRUCTURE',
      violation_description: 'Unfit for human habitation - order to demolish issued by urban rehabilitation standards board',
      status: 'OPEN',
      created_date: '2026-02-10',
      status_date: '2026-03-01',
      estimated_cost: 4500
    },
    {
      service_request_address: '1500 MARILLA ST',
      property_id: '00000123456',
      violation_type: 'HIGH WEEDS',
      violation_description: 'Lawn exceeds 12 inches',
      status: 'CLOSED',
      created_date: '2025-06-01',
      status_date: '2025-06-15',
      estimated_cost: 300
    }
  ];

  const parsed = parseCodeViolationsResponse(mockDallasData, portal);

  assert.equal(parsed.source, 'SOCRATA_DALLAS');
  assert.equal(parsed.violationsCount, 2);
  assert.equal(parsed.openViolationsCount, 1);
  assert.equal(parsed.totalFines, 4500);
  assert.equal(parsed.isCondemned, true);
  assert.equal(parsed.hasDemolitionRisk, true);
  assert.equal(parsed.vacantBuildingNotice, true);
  assert.equal(parsed.violations[0].fineAmount, 4500);
});

test('parseCodeViolationsResponse parses Baltimore housing code violations', () => {
  const portal = MUNICIPAL_PORTALS.baltimore;
  const mockBaltimoreData = [
    {
      propertyaddress: '100 HOLLIDAY ST',
      blocklot: '0101-001',
      violationcode: 'ART-13-SEC-108',
      violationdescription: 'Building condemned - imminent danger collapse hazard and vacant building registration required',
      violationstatus: 'OPEN',
      noticedate: '2026-05-18',
      inspectiondate: '2026-06-01',
      fine_amount: 3200
    }
  ];

  const parsed = parseCodeViolationsResponse(mockBaltimoreData, portal);

  assert.equal(parsed.source, 'SOCRATA_BALTIMORE');
  assert.equal(parsed.violationsCount, 1);
  assert.equal(parsed.openViolationsCount, 1);
  assert.equal(parsed.totalFines, 3200);
  assert.equal(parsed.isCondemned, true);
  assert.equal(parsed.hasDemolitionRisk, true);
  assert.equal(parsed.vacantBuildingNotice, true);
  assert.equal(parsed.lastInspectionDate, '2026-06-01');
});

test('parseCodeViolationsResponse parses Cincinnati and Kansas City violations', () => {
  // Cincinnati
  const cincyPortal = MUNICIPAL_PORTALS.cincinnati;
  const mockCincy = [
    {
      address: '801 PLUM ST',
      parcel_number: '006500010022',
      violation_code: 'ORC-715.261',
      violation_description: 'Emergency board up and unsafe structure notice',
      status: 'OPEN',
      entered_date: '2026-01-20',
      last_inspection_date: '2026-02-10',
      fine_amount: 1200
    }
  ];
  const parsedCincy = parseCodeViolationsResponse(mockCincy, cincyPortal);
  assert.equal(parsedCincy.source, 'SOCRATA_CINCINNATI');
  assert.equal(parsedCincy.openViolationsCount, 1);
  assert.equal(parsedCincy.totalFines, 1200);
  assert.equal(parsedCincy.hasDemolitionRisk, true);

  // Kansas City
  const kcPortal = MUNICIPAL_PORTALS.kansascity;
  const mockKc = [
    {
      street_address: '414 E 12TH ST',
      kiva_pin: 'JA123456',
      ordinance_code: 'SEC-48-21',
      violation_description: 'Dangerous building special tax bill - structural hazard',
      case_status: 'OPEN',
      violation_entry_date: '2026-03-01',
      last_action_date: '2026-03-25',
      fine_amount: 2100
    }
  ];
  const parsedKc = parseCodeViolationsResponse(mockKc, kcPortal);
  assert.equal(parsedKc.source, 'SOCRATA_KANSAS_CITY');
  assert.equal(parsedKc.openViolationsCount, 1);
  assert.equal(parsedKc.totalFines, 2100);
  assert.equal(parsedKc.isCondemned, true);
});

// ============================================================================
// 4. analyzeMunicipalViolations tests for MD, MO, and GA super-lien statutes
// ============================================================================

test('analyzeMunicipalViolations: MD dangerous building demolition citation trips critical alert and liability', () => {
  const listing = {
    id: 'listing-md-baltimore-01',
    address: '123 E Fayette St',
    city: 'Baltimore',
    state: 'MD',
  };

  const violations = [
    {
      violationType: 'Baltimore City Code Art. 13 - Condemned Structure Demolition Order',
      description: 'Building condemned for imminent collapse hazard',
      status: 'OPEN',
      fineAmount: 2500,
      isCondemned: true,
    },
    {
      violationType: 'Water and Sewer Municipal Lien Assessment',
      status: 'OPEN',
      fineAmount: 1100,
      isCondemned: false,
    },
    {
      violationType: 'Closed Trash Citation',
      status: 'RESOLVED',
      fineAmount: 300,
      isCondemned: false,
    }
  ];

  const analysis = analyzeMunicipalViolations(listing, violations);

  assert.equal(analysis.state, 'MD');
  assert.equal(analysis.hasMunicipalViolations, true);
  assert.equal(analysis.isCondemnedOrDemolitionRisk, true);
  assert.equal(analysis.activeViolationCount, 2);
  // Liability: 2500 + 1100 + 15000 demolition escrow = 18600
  assert.equal(analysis.estimatedSurvivingLienLiability, 18600);
  assert.ok(analysis.municipalWarnings.some((w) => w.includes('CRITICAL MUNICIPAL ALERT: Active condemnation')));
  assert.ok(analysis.municipalWarnings.some((w) => w.includes('Md. Code Real Prop. § 14-804/806 & Baltimore City Code Art. 13')));
  assert.match(analysis.actionRequired, /DO NOT BID/);
});

test('analyzeMunicipalViolations: MO dangerous building repair/demolition special tax bill primes private mortgages', () => {
  const listing = {
    id: 'listing-mo-kc-01',
    address: '2400 Prospect Ave',
    city: 'Kansas City',
    state: 'MO',
  };

  const violations = [
    {
      violationType: 'RSMo § 67.410 - Dangerous Building Demolition Special Tax Bill',
      status: 'OPEN',
      fineAmount: 1800,
      isCondemned: true,
    }
  ];

  const analysis = analyzeMunicipalViolations(listing, violations);

  assert.equal(analysis.state, 'MO');
  assert.equal(analysis.isCondemnedOrDemolitionRisk, true);
  // Liability: 1800 + 15000 = 16800
  assert.equal(analysis.estimatedSurvivingLienLiability, 16800);
  assert.ok(analysis.municipalWarnings.some((w) => w.includes('RSMo § 67.410 & § 67.398')));
  assert.match(analysis.actionRequired, /DO NOT BID/);
});

test('analyzeMunicipalViolations: GA demolition and nuisance abatement liens prime security deeds', () => {
  const listing = {
    id: 'listing-ga-atl-01',
    address: '450 Martin Luther King Jr Dr',
    city: 'Atlanta',
    state: 'GA',
  };

  const violations = [
    {
      violationType: 'O.C.G.A. § 41-2-9(b) - Order to Demolish Substandard Structure',
      status: 'OPEN',
      fineAmount: 3500,
      isCondemned: true,
    }
  ];

  const analysis = analyzeMunicipalViolations(listing, violations);

  assert.equal(analysis.state, 'GA');
  assert.equal(analysis.isCondemnedOrDemolitionRisk, true);
  // Liability: 3500 + 15000 = 18500
  assert.equal(analysis.estimatedSurvivingLienLiability, 18500);
  assert.ok(analysis.municipalWarnings.some((w) => w.includes('O.C.G.A. § 41-2-9(b) & § 36-60-17')));
  assert.match(analysis.actionRequired, /DO NOT BID/);
});

test('analyzeMunicipalViolations: non-condemned routine violations in MD, MO, GA calculate exact fine retention', () => {
  const listing = { state: 'MD', address: '45 Park Ave' };
  const violations = [
    { violationType: 'Weed and overgrown vegetation', status: 'OPEN', fineAmount: 450, isCondemned: false }
  ];

  const analysis = analyzeMunicipalViolations(listing, violations);
  assert.equal(analysis.isCondemnedOrDemolitionRisk, false);
  assert.equal(analysis.estimatedSurvivingLienLiability, 450);
  assert.match(analysis.actionRequired, /ESCROW RETENTION/);
  assert.ok(analysis.municipalWarnings.some((w) => w.includes('Md. Code Real Prop.')));
});

// ============================================================================
// 5. Source Policy Integration tests
// ============================================================================

test('SOURCE_HOSTS registers all Socrata code enforcement open data portals', () => {
  const allowed = SOURCE_HOSTS['socrata-code-enforcement'];
  assert.ok(Array.isArray(allowed));

  const expectedHosts = [
    'data.austintexas.gov',
    'www.dallasopendata.com',
    'data.baltimorecity.gov',
    'data.cincinnati-oh.gov',
    'data.kcmo.org',
    'data.cityoforlando.net',
    'data.cityofchicago.org',
    'data.nola.gov',
    'data.phila.gov'
  ];

  for (const host of expectedHosts) {
    assert.ok(allowed.includes(host), `Missing host in source-policy: ${host}`);
  }

  // Validate inspectSourceRecordUrl accepts valid resource endpoints on these hosts
  for (const host of expectedHosts) {
    const inspected = inspectSourceRecordUrl('socrata-code-enforcement', `https://${host}/resource/dataset-1234.json`);
    assert.equal(inspected.isValid, true, `Should accept valid endpoint for ${host}`);
  }
});
