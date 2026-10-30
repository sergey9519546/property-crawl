'use strict';
const test=require('node:test'); const assert=require('node:assert/strict');
const query=require('../server/discovery/query'); const {DatabaseClient}=require('../server/db/client');
const rows=[
 {id:'a',source:'servicelink',state:'CA',county:'Los Angeles',address:'1 Main St',propType:'Land',status:'active',lat:34,lng:-118,openingBid:10,dealScore:90,sourceObservedAt:'2026-09-05T00:00:00Z',provenance:{origin:'live',recordId:'p1',sourceFacts:{auctionProgram:'TPS'}}},
 {id:'b',source:'hud',state:'FL',county:null,address:'2 Palm St',propType:'Single Family',status:'scheduled',lat:25,lng:179,openingBid:null,dealScore:null,sourceObservedAt:'2026-09-05T00:00:00Z',provenance:{origin:'live',recordId:'p2'}}
];
const db={getListings:async()=>({total:rows.length,listings:rows})};
function url(q=''){return new URL(`http://local/api/listings?${q}`);}
test('discovery search returns facets and a revision-bound cursor',async()=>{const first=await query.search(db,query.queryFromUrl(url('limit=1&facets=state,program')));assert.equal(first.listings.length,1);assert.equal(first.page.hasMore,true);assert.deepEqual(first.facets.program,[{value:'TPS',count:1},{value:'unknown',count:1}]);const next=await query.search(db,query.queryFromUrl(url(`limit=1&facets=state,program&cursor=${first.page.nextCursor}`)));assert.equal(next.listings[0].id,'b');await assert.rejects(()=>query.search(db,query.queryFromUrl(url(`limit=1&state=CA&cursor=${first.page.nextCursor}`))),/does not match/);});
test('bbox accepts antimeridian crossing and map stays minimal',async()=>{const f=query.queryFromUrl(url('bbox=170,-10,-170,40&limit=100'));const result=await query.map(db,f);assert.deepEqual(result.features.map(x=>x.properties.id),['b']);assert.deepEqual(Object.keys(result.features[0].properties).sort(),['count','id','source','status']);});
test('invalid geographic, boolean, and enum parameters fail closed',()=>{assert.throws(()=>query.queryFromUrl(url('bbox=-181,0,1,2')),/Invalid bbox/);assert.throws(()=>query.queryFromUrl(url('bbox=1,0,1,2')),/Invalid bbox/);assert.throws(()=>query.queryFromUrl(url('hasDocuments=yes')),/true, false, or unknown/);assert.throws(()=>query.queryFromUrl(url('sort=bogus')),/Invalid sort/);assert.equal(query.queryFromUrl(url('sort=bid')).sort,'bid-asc');assert.throws(()=>query.queryFromUrl(url('freshness=bogus')),/Invalid freshness/);assert.equal(query.queryFromUrl(url('freshness=observed')).freshness,'observed');});
test('invalid calendar, zoom, and pagination combinations fail closed',()=>{assert.throws(()=>query.queryFromUrl(url('saleFrom=2026-02-30')),/Invalid saleFrom/);assert.throws(()=>query.queryFromUrl(url('saleFrom=2026-09-02&saleTo=2026-09-01')),/must not be after/);assert.throws(()=>query.queryFromUrl(url('zoom=21')),/zoom/);assert.throws(()=>query.queryFromUrl(url('offset=1&cursor=e30')),/combined/);});
test('offset remains compatible and exact identifiers are searchable',async()=>{const first=await query.search(db,query.queryFromUrl(url('offset=1&limit=1')));assert.equal(first.listings[0].id,'b');const exact=await query.search(db,query.queryFromUrl(url('q=p2')));assert.deepEqual(exact.listings.map(x=>x.id),['b']);});
test('unknown document evidence stays distinct from an explicit false bucket',async()=>{const unknown={...rows[0],id:'unknown-docs',hasDocuments:undefined,provenance:{origin:'live'}};const knownFalse={...rows[0],id:'known-false',hasDocuments:false};const result=await query.search({getListings:async()=>({total:2,listings:[unknown,knownFalse]})},query.queryFromUrl(url('hasDocuments=false')));assert.deepEqual(result.listings.map(x=>x.id),['known-false']);});
test('unknown document filter selects only unobserved document evidence',async()=>{const unknown={...rows[0],id:'unknown-docs',hasDocuments:undefined,provenance:{origin:'live'}};const knownFalse={...rows[0],id:'known-false',hasDocuments:false};const result=await query.search({getListings:async()=>({total:2,listings:[unknown,knownFalse]})},query.queryFromUrl(url('hasDocuments=unknown')));assert.deepEqual(result.listings.map(x=>x.id),['unknown-docs']);});
test('advanced mode requires PostgreSQL configuration',()=>{assert.throws(()=>new DatabaseClient({env:{DISCOVERY_MODE:'advanced',NODE_ENV:'test'}}),/requires DATABASE_URL/);});
test('advanced mode accepts the embedded engine without opening DATABASE_URL',()=>{
  const db=new DatabaseClient({env:{DISCOVERY_MODE:'advanced',PROPERTY_DB:'embedded',DATABASE_URL:'postgres://localhost:5432/ignored',NODE_ENV:'test'}});
  assert.equal(db.pool,null);
  assert.equal(db.isPg,false);
});
test('discovery migrations target the embedded engine when it is requested',()=>{
  const {migrationTarget}=require('../scripts/discovery-migrate');
  assert.equal(migrationTarget({}),'missing');
  assert.equal(migrationTarget({DATABASE_URL:'postgres://localhost/db'}),'tcp');
  assert.equal(migrationTarget({DATABASE_URL:'postgres://localhost/db',PROPERTY_DB:'embedded'}),'embedded');
  assert.equal(migrationTarget({DATABASE_URL:'postgres://localhost/db',PROPERTY_DB:'embedded',NODE_ENV:'production'}),'tcp');
  assert.equal(migrationTarget({PROPERTY_PG_DATA_DIR:'.cache/pgdata'}),'embedded');
});
test('DATABASE_URL is fully functional only with PostgreSQL 14+, the four extensions, public privileges, and the migrated columns', async () => {
  const { probeDatabaseCapabilities, requiredRelationNames, REQUIRED_EXTENSIONS, REQUIRED_COLUMNS } = require('../server/db/database-capabilities');
  const extensions = Object.fromEntries(REQUIRED_EXTENSIONS.map((name) => [name, '1']));
  const tables = requiredRelationNames();
  const columns = REQUIRED_COLUMNS.map(([table, column]) => `${table}.${column}`);
  const ready = {
    version_num: 160000,
    version: '16.4',
    extensions,
    tables,
    columns,
    public_visible: true,
    schema_usage: true,
    schema_create: true,
    database_create: true,
    listings_select: true,
    listings_insert: true,
    listings_update: true,
    listings_delete: true,
    geography: true,
    uuid_generate_v4: true,
    st_dwithin: true,
    digest: true,
    gin_trgm_ops: true,
  };
  const full = await probeDatabaseCapabilities({
    query: async (sql) => {
      if (sql.includes('postgis_version')) return { rows: [{ v: '3.4.0' }] };
      return { rows: [{ ...ready, extensions: JSON.stringify(extensions), tables: JSON.stringify(tables), columns: JSON.stringify(columns) }] };
    },
  });
  assert.equal(full.functional, true);
  assert.equal(full.postgisVersion, '3.4.0');
  const bare = await probeDatabaseCapabilities({
    query: async () => ({ rows: [{ version_num: 160000, version: '16.4', extensions: {}, tables: [], columns: [] }] }),
  });
  assert.equal(bare.functional, false);
  assert.ok(bare.missing.includes('extension:postgis'));
  assert.ok(bare.missing.includes('extension:pg_trgm'));
  assert.ok(bare.missing.includes('search_path:public'));
  assert.ok(bare.missing.includes('privilege:database:create'));
  assert.ok(bare.missing.includes('function:st_dwithin'));
  assert.ok(bare.missing.includes('table:listings'));
  assert.ok(bare.missing.includes('table:discovery_jobs'));
  assert.ok(bare.missing.includes('table:source_observations'));
  assert.ok(bare.missing.includes('table:mv_neighborhood_stats'));
  assert.ok(bare.missing.includes('column:listings.triage_priority'));
  assert.ok(bare.missing.includes('column:discovery_jobs.lease_expires_at'));
  const drifted = await probeDatabaseCapabilities({
    query: async (sql) => {
      if (sql.includes('postgis_version')) return { rows: [{ v: '3.4.0' }] };
      return { rows: [{ ...ready, columns: columns.filter((name) => name !== 'listings.triage_priority') }] };
    },
  });
  assert.equal(drifted.functional, false);
  assert.deepEqual(drifted.missing, ['column:listings.triage_priority']);
  const old = await probeDatabaseCapabilities({
    query: async () => ({ rows: [{ ...ready, version_num: 120000, version: '12.20' }] }),
  });
  assert.equal(old.functional, false);
  assert.match(old.missing[0], /postgresql>=14/);
});
test('Render uses DATABASE_URL when PROPERTY_DB=embedded is also set', async () => {
  const { migrationTarget } = require('../scripts/discovery-migrate');
  const { databaseTargetReason } = require('../server/db/database-target');
  const env = {
    DISCOVERY_MODE: 'advanced',
    PROPERTY_DB: 'embedded',
    PROPERTY_PG_DATA_DIR: '.cache/pgdata',
    DATABASE_URL: 'postgres://localhost:5432/live',
    RENDER: 'true',
    NODE_ENV: 'test',
  };
  assert.equal(migrationTarget(env), 'tcp');
  assert.match(databaseTargetReason(env), /external database is used/);
  const db = new DatabaseClient({ env });
  try {
    assert.ok(db.pool);
    assert.equal(db.isPg, false);
  } finally {
    if (db.pool) await db.pool.end();
  }
});
test('PostgreSQL discovery filters and paginates in SQL without loading inventory',async()=>{const calls=[];const database={isPg:true,listingSelect:'id, source_key AS "source", state, address, updated_at AS "fetchedAt"',pool:{query:async(sql,params=[])=>{calls.push({sql,params});if(sql.includes('discovery_listing_revision'))return{rows:[{revision:'7'}]};if(sql.includes('count(*)::int'))return{rows:[{count:1}]};return{rows:[{id:'pg1',source:'hud',state:'CA',address:'1 SQL Way',cursorValue:7}]};}}};const result=await query.search(database,query.queryFromUrl(url('state=CA&program=tps&limit=25')));assert.equal(result.total,1);assert.equal(result.listings[0].id,'pg1');assert.match(calls[1].sql,/lower\(state\)=\$1/);assert.match(calls[1].sql,/lower\(nullif\(coalesce\(auction_program,[^,]*auctionProgram'\),''\)\)=\$2/);assert.match(calls[1].sql,/ORDER BY/);});
