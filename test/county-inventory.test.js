const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadCountyInventory } = require('../src/lib/county-inventory');
const base = {stateCode:'OH', county:'Cuyahoga', apiUrl:'http://inventory.invalid'};
test('county transport preserves authoritative empty and real results', async () => {
  let localCalls=0;
  for(const listings of [[],[{id:'real'}]]) assert.deepEqual(await loadCountyInventory({...base,fetchImpl:async()=>({ok:true,json:async()=>({listings})}),searchLocal:async()=>{localCalls++;throw Error();}}),listings);
  assert.equal(localCalls,0);
});
test('county outage is an error rather than an empty result that becomes 404', async () => {
  const fetchImpl=async()=>({ok:false,status:503});
  assert.deepEqual(await loadCountyInventory({...base,fetchImpl,searchLocal:async()=>({listings:[{id:'local'}]})}),[{id:'local'}]);
  for(const searchLocal of [async()=>{throw Error('offline');},async()=>({listings:[],readError:'offline'})]) await assert.rejects(loadCountyInventory({...base,fetchImpl,searchLocal}),/temporarily unavailable/);
});
