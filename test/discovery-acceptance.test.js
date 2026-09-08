'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createIsolatedDatabase, seedListings } = require('./discovery-acceptance-db');
const { createDiscoveryStore } = require('../server/discovery/store');
const discovery = require('../server/discovery/query');
const { DatabaseClient } = require('../server/db/client');
const { createHuntsHandler } = require('../server/routes/hunts');
const { createPgHuntStore } = require('../server/discovery/hunt-store');

let isolated;
test.before(async () => { isolated = await createIsolatedDatabase(); });
test.after(async () => { if (isolated) await isolated.close(); });

test('migrations expose PostGIS and every durable discovery table', async () => {
  const result = await isolated.pool.query(`SELECT extname FROM pg_extension WHERE extname IN ('postgis','pg_trgm') ORDER BY extname`);
  assert.deepEqual(result.rows.map((row) => row.extname), ['pg_trgm', 'postgis']);
  const tables = await isolated.pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name LIKE 'discovery_%'");
  const names = new Set(tables.rows.map((row) => row.table_name));
  for (const name of ['discovery_source_runs','discovery_snapshots','discovery_observations','discovery_checkpoints','discovery_jobs','discovery_leases','discovery_imports']) assert.ok(names.has(name), name);
});

test('runs, snapshots, checkpoints, jobs, and leases survive store recreation', async () => {
  const first = createDiscoveryStore(isolated.pool);
  const run = await first.beginRun({ sourceKey: 'hud', idempotencyKey: 'acceptance-run', scope: { state: 'CA' } });
  const sameRun = await first.beginRun({ sourceKey: 'hud', idempotencyKey: 'acceptance-run', scope: { state: 'CA' } });
  assert.equal(sameRun.id, run.id);
  const observedAt = '2026-09-07T12:00:00.000Z';
  const snapshot = await first.appendSnapshot({ runId: run.id, sourceKey: 'hud', sourceRecordId: 'private-record-1', observedAt, rawPayload: { address: 'private acceptance fixture' }, observations: { status: 'active' } });
  const duplicate = await first.appendSnapshot({ runId: run.id, sourceKey: 'hud', sourceRecordId: 'private-record-1', observedAt, rawPayload: { address: 'private acceptance fixture' }, observations: { status: 'active' } });
  assert.equal(duplicate.id, snapshot.id);
  await first.saveCheckpoint('hud', { page: 7 }, { state: 'CA' });
  assert.equal(await first.acquireLease('hud:CA', 'worker-a', 30), true);
  assert.equal(await first.acquireLease('hud:CA', 'worker-b', 30), false);
  const job = await first.createOrReuseJob({ idempotencyKey: 'acceptance-job', sourceIds: ['hud'] });
  const restarted = createDiscoveryStore(isolated.pool);
  assert.deepEqual((await restarted.getCheckpoint('hud')).cursor, { page: 7 });
  assert.equal((await restarted.getJob(job.id)).id, job.id);
  assert.equal(await restarted.renewLease('hud:CA', 'worker-a', 30), true);
  assert.equal(await restarted.releaseLease('hud:CA', 'worker-a'), true);
  const raw = await isolated.pool.query('SELECT raw_payload FROM discovery_snapshots WHERE id=$1', [snapshot.id]);
  assert.equal(raw.rows[0].raw_payload.address, 'private acceptance fixture');
});

test('collection job claims are atomic and idempotency keys bind to one scope', async () => {
  const store = createDiscoveryStore(isolated.pool);
  const job = await store.createOrReuseJob({ idempotencyKey: 'atomic-job', sourceIds: ['hud'], payload: { state: 'CA' } });
  const same = await store.createOrReuseJob({ idempotencyKey: 'atomic-job', sourceIds: ['hud'], payload: { state: 'CA' } });
  assert.equal(same.id, job.id);
  await assert.rejects(() => store.createOrReuseJob({ idempotencyKey: 'atomic-job', sourceIds: ['hud'], payload: { state: 'FL' } }), /different collection scope/);
  const claims = await Promise.all(Array.from({ length: 10 }, (_, index) => store.claimJob(job.id, `worker-${index}`, 30)));
  assert.equal(claims.filter(Boolean).length, 1);
  const persisted = await isolated.pool.query('SELECT status,lease_owner,attempt_count FROM discovery_jobs WHERE id=$1', [job.id]);
  assert.equal(persisted.rows[0].status, 'running');
  assert.equal(persisted.rows[0].attempt_count, 1);
  assert.match(persisted.rows[0].lease_owner, /^worker-/);
});

test('job stage and error JSON remains structured across repeated guarded updates', async () => {
  const store=createDiscoveryStore(isolated.pool);const job=await store.createOrReuseJob({idempotencyKey:'json-stage-job',sourceIds:['irs']});
  const claimed=await store.claimJob(job.id,'json-worker',30);assert.equal(claimed.leaseOwner,'json-worker');
  const first=await store.updateJob(job.id,{stage:{name:'collection',value:{status:'running'}},error:{stage:'collection',message:'publisher timeout'}},{ownerId:'json-worker'});
  assert.equal(first.stages.collection.status,'running');assert.equal(first.errors.length,1);
  const second=await store.updateJob(job.id,{status:'partial',completed:true,stage:{name:'collection',value:{status:'failed'}},error:{stage:'collection',message:'retry exhausted'},result:{accepted:3}},{ownerId:'json-worker'});
  assert.equal(second.stages.collection.status,'failed');assert.equal(second.errors.length,2);assert.deepEqual(second.result,{accepted:3});
  assert.equal(Array.isArray(second.errors),true);assert.equal(typeof second.stages,'object');
});

test('PostgreSQL search cursor rejects inventory mutation and map uses PostGIS', async () => {
  await seedListings(isolated.pool, 80);
  const database = new DatabaseClient({ env: { NODE_ENV: 'test' } });
  database.pool = isolated.pool; database.isPg = true;
  const query = discovery.queryFromUrl(new URL('http://localhost/api/listings?state=ca&limit=10&facets=source'));
  const first = await discovery.search(database, query);
  assert.equal(first.listings.length, 10);
  assert.ok(first.page.nextCursor);
  const second = await discovery.search(database, { ...query, cursor: first.page.nextCursor });
  assert.equal(new Set([...first.listings, ...second.listings].map((row) => row.id)).size, 20);
  await isolated.pool.query("UPDATE listings SET updated_at=NOW()+interval '1 second' WHERE id=$1", [first.listings[0].id]);
  await assert.rejects(() => discovery.search(database, { ...query, cursor: first.page.nextCursor }), (error) => error.status === 409);
  const map = await discovery.map(database, discovery.queryFromUrl(new URL('http://localhost/api/listings/map?bbox=-125,24,-66,50&limit=20')));
  assert.equal(map.type, 'FeatureCollection');
  assert.ok(map.features.length > 0);
});

test('unknown categorical facets select null and blank values with PG/memory parity', async () => {
  await isolated.pool.query("INSERT INTO listings(id,source_key,state,address,prop_type,auction_program,occupancy,status) VALUES ('unknown-null','hud','CA','Null Category',NULL,NULL,NULL,'active'),('unknown-blank','hud','CA','Blank Category','','','','active'),('known-category','hud','CA','Known Category','Land','TPS','vacant','active')");
  const pgDatabase=new DatabaseClient({env:{NODE_ENV:'test'}});pgDatabase.pool=isolated.pool;pgDatabase.isPg=true;
  for(const parameter of ['type','program','occupancy']){const parsed=discovery.queryFromUrl(new URL(`http://localhost/api/listings?q=category&${parameter}=unknown&limit=10&facets=${parameter}`));const result=await discovery.search(pgDatabase,parsed);assert.deepEqual(result.listings.map(row=>row.id).sort(),['unknown-blank','unknown-null']);assert.deepEqual(result.facets[parameter],[{value:'unknown',count:2}]);
    const memory={isPg:false,getListings:async()=>({total:3,listings:[{id:'unknown-null',source:'hud',state:'CA',address:'Null Category',propType:null,auctionProgram:null,occupancy:null,status:'active'},{id:'unknown-blank',source:'hud',state:'CA',address:'Blank Category',propType:'',auctionProgram:'',occupancy:'',status:'active'},{id:'known-category',source:'hud',state:'CA',address:'Known Category',propType:'Land',auctionProgram:'TPS',occupancy:'vacant',status:'active'}]})};const memoryResult=await discovery.search(memory,parsed);assert.deepEqual(memoryResult.listings.map(row=>row.id).sort(),['unknown-blank','unknown-null']);}
});

test('advanced hunt route pages and persists a baseline beyond 10000 PostgreSQL listings',{timeout:60000},async()=>{
  await isolated.pool.query('DELETE FROM listings');await seedListings(isolated.pool,10050);
  await isolated.pool.query(`UPDATE listings SET id='HUD-CA-'||substring(id from '[0-9]+'),source_key='hud',state='CA',source_url='https://www.hudhomestore.gov/property/propertydetails?caseNumber='||substring(id from '[0-9]+'),raw_notice='Official HUD publisher record '||substring(id from '[0-9]+'),source_observed_at='2026-09-05T18:00:00Z',provenance=jsonb_build_object('origin','live','observed',true,'recordKind','source_record','publisher','HUD','recordId',substring(id from '[0-9]+'),'observedAt','2026-09-05T18:00:00Z')`);
  const database=new DatabaseClient({env:{NODE_ENV:'test'}});database.pool=isolated.pool;database.isPg=true;
  const durable=createPgHuntStore(database);const hunt=await durable.create({name:'All CA acceptance',enabled:true,criteria:{mode:'all',rules:[{field:'state',operator:'eq',value:'CA'}]}});
  const handler=createHuntsHandler({database,durableStore:durable,env:{DISCOVERY_MODE:'advanced',SCRAPER_ADMIN_TOKEN:'acceptance-token'},now:()=> '2026-09-07T20:00:00.000Z'});
  const invoke=async()=>{const req={method:'POST',url:`/api/hunts/${hunt.id}/evaluate`,headers:{authorization:'Bearer acceptance-token'},body:{}};const res={statusCode:200,setHeader(){},status(code){this.statusCode=code;return this;},json(value){this.body=value;return value;}};await handler(req,res,new URL(req.url,'http://localhost'));assert.equal(res.statusCode,200);return res.body.evaluation;};
  const first=await invoke();const count=Number((await isolated.pool.query('SELECT count(*)::int AS count FROM discovery_hunt_baselines WHERE hunt_id=$1',[hunt.id])).rows[0].count);assert.equal(count,10050);assert.equal(first.newEvents.length,0);
  const second=await invoke();assert.equal(second.newEvents.length,0);assert.equal(Number((await isolated.pool.query('SELECT count(*)::int AS count FROM discovery_hunt_baselines WHERE hunt_id=$1',[hunt.id])).rows[0].count),10050);
});
