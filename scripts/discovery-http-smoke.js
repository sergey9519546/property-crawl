'use strict';
const crypto=require('node:crypto');

const API=process.env.DISCOVERY_SMOKE_API_URL||'http://127.0.0.1:3102';
const UI=process.env.DISCOVERY_SMOKE_UI_URL||'http://localhost:3103';
const credential=process.env.SCRAPER_ADMIN_TOKEN;
if(!credential)throw new Error('SCRAPER_ADMIN_TOKEN is required');
const nonce=crypto.randomUUID();let cookie='',huntId=null,listingId=null;
const check=(condition,message)=>{if(!condition)throw new Error(message);};
async function request(url,options={},attempt=0){try{return await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000),...options});}catch(error){if(attempt<2){await new Promise(r=>setTimeout(r,500*(attempt+1)));return request(url,options,attempt+1);}throw error;}}
async function json(url,options={}){const response=await request(url,options);let body=null;try{body=await response.json();}catch{}return {response,body};}
async function cursorPage(state,limit,attempt=0){
  const first=await json(`${UI}/api/listings?state=${encodeURIComponent(state)}&limit=${limit}`);check(first.response.ok&&first.body?.listings?.length,'filtered listings unavailable');
  const cursor=first.body.page?.nextCursor;if(!cursor)return {first,second:null};
  const second=await json(`${UI}/api/listings?state=${encodeURIComponent(state)}&limit=${limit}&cursor=${encodeURIComponent(cursor)}`);
  if(second.response.status===409&&attempt<2)return cursorPage(state,limit,attempt+1);
  check(second.response.ok,`cursor page failed (${second.response.status})`);return {first,second};
}
const authHeaders=(extra={})=>({cookie,origin:UI,'content-type':'application/json',...extra});
async function main(){
  const ready=await json(`${API}/api/health/ready`);check(ready.response.ok&&ready.body?.ready===true,'API readiness failed');
  check((await request(`${UI}/api/alerts`)).status===401,'alerts allowed anonymous access');check((await request(`${UI}/api/hunts`)).status===401,'hunts allowed anonymous access');
  check((await request(`${UI}/api/alerts`,{headers:{'x-user-id':'smoke-spoof'}})).status===401,'x-user-id bypassed authentication');
  const login=await json(`${UI}/api/workspace/session`,{method:'POST',headers:{origin:UI,'content-type':'application/json'},body:JSON.stringify({credential})});check(login.response.ok&&login.body?.authenticated,'workspace login failed');cookie=String(login.response.headers.get('set-cookie')||'').split(';')[0];check(cookie,'workspace cookie missing');
  const beforeWatchlist=await json(`${UI}/api/alerts`,{headers:{cookie}});check(beforeWatchlist.response.ok,'watchlist preflight failed');const existingIds=new Set((beforeWatchlist.body?.deals||[]).map(x=>x.id));
  const {first:page,second}=await cursorPage('CA',50);listingId=page.body.listings.find(item=>!existingIds.has(item.id))?.id;check(listingId,'no isolated listing is available for smoke test');
  if(second)check(!new Set(page.body.listings.map(x=>x.id)).has(second.body.listings?.[0]?.id),'cursor repeated first-page record');
  const exported=await json(`${UI}/api/export?format=json&state=CA` ,{headers:{cookie,origin:UI}});check(exported.response.ok&&Array.isArray(exported.body),'JSON export failed');check(exported.body.every(x=>x.state==='CA'),'export filter parity failed');
  check((await json(`${UI}/api/alerts`,{method:'POST',headers:authHeaders(),body:JSON.stringify({listingId})})).response.status===201,'watchlist save failed');const saved=await json(`${UI}/api/alerts`,{headers:{cookie}});check(saved.body?.deals?.some(x=>x.id===listingId),'watchlist read failed');
  const created=await json(`${UI}/api/hunts`,{method:'POST',headers:authHeaders(),body:JSON.stringify({name:`smoke-${nonce}`,enabled:true,criteria:{mode:'all',rules:[{field:'state',operator:'eq',value:'CA'}]}})});check(created.response.status===201,'hunt create failed');huntId=created.body.hunt.id;
  check((await json(`${UI}/api/hunts/${huntId}/evaluate`,{method:'POST',headers:authHeaders(),body:'{}'})).response.ok,'hunt evaluate failed');check((await json(`${UI}/api/hunts/${huntId}`,{headers:{cookie}})).response.ok,'hunt read failed');
  const hud=await json(`${UI}/api/listings?source=hud&state=CA&limit=1`);const target=hud.body?.listings?.[0];check(target,'HUD parity fixture unavailable');
  const discoveryFilters={q:target.id,source:'hud',state:'CA',program:'HUD REO',hasDocuments:'unknown'};
  const expected=await json(`${UI}/api/listings?${new URLSearchParams({...discoveryFilters,limit:'100'})}`);check(expected.response.ok&&expected.body?.total===1,'discovery parity query must identify one live HUD record');
  const updated=await json(`${UI}/api/hunts/${huntId}`,{method:'PATCH',headers:authHeaders(),body:JSON.stringify({criteria:{discoveryFilters}})});check(updated.response.ok&&updated.body?.hunt?.criteria?.discoveryFilters?.hasDocuments==='unknown','saved discovery filters were not retained');
  check((await json(`${UI}/api/hunts/${huntId}/evaluate`,{method:'POST',headers:authHeaders(),body:'{}'})).response.ok,'discovery hunt evaluation failed');
  const detail=await json(`${UI}/api/hunts/${huntId}`,{headers:{cookie}});const matchIds=Object.values(detail.body?.baseline?.records||{}).filter(x=>x.status==='match').map(x=>x.listingId).sort();
  check(JSON.stringify(matchIds)===JSON.stringify(expected.body.listings.map(x=>x.id).sort()),'saved discovery filters and search returned different matches');
  return {ok:true,readiness:true,authIsolation:true,watchlistPersistence:true,huntLifecycle:true,discoveryHuntParity:true,exportParity:true,cursorParity:true};
}
async function cleanup(){if(cookie&&huntId)await request(`${UI}/api/hunts/${huntId}`,{method:'DELETE',headers:authHeaders(),body:'{}'}).catch(()=>{});if(cookie&&listingId)await request(`${UI}/api/alerts`,{method:'DELETE',headers:authHeaders(),body:JSON.stringify({listingId})}).catch(()=>{});if(cookie)await request(`${UI}/api/workspace/session`,{method:'DELETE',headers:{cookie,origin:UI}}).catch(()=>{});}
main().then(result=>console.log(JSON.stringify(result))).finally(cleanup).catch(error=>{console.error(error.message);process.exitCode=1;});
