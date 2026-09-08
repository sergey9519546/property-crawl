'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {discoveryReadiness}=require('../server/discovery-readiness');
test('advanced readiness fails without a live probe',async()=>{const value=await discoveryReadiness({env:{DATABASE_URL:'configured'}});assert.equal(value.ready,false);});
test('advanced readiness checks required tables and PostGIS',async()=>{const value=await discoveryReadiness({env:{DATABASE_URL:'configured'},databaseProbe:async()=>({postgis:true,tables:['listings','discovery_source_runs','discovery_snapshots','discovery_checkpoints','discovery_jobs','discovery_leases']})});assert.equal(value.ready,true);});
test('advanced readiness rejects incomplete schema',async()=>{const value=await discoveryReadiness({env:{DATABASE_URL:'configured'},databaseProbe:async()=>({postgis:false,tables:['listings']})});assert.equal(value.ready,false);assert.match(value.checks.database.reason,/missing|PostGIS/);});
