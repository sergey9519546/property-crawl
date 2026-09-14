'use strict';
const ORIGIN='https://api.panoramax.xyz',MAX_BYTES=1_000_000,DISPLAY_LICENSES=new Set(['CC-BY-SA-4.0','ETALAB-2.0']);
function strictNumber(v,min,max,name){if(typeof v!=='number'||!Number.isFinite(v)||v<min||v>max)throw new TypeError('Panoramax '+name+' must be a finite number');return v;}
function integer(v,d,max,name){if(v==null)return d;if(typeof v!=='number'||!Number.isSafeInteger(v)||v<1||v>max)throw new RangeError('Panoramax '+name+' must be between 1 and '+max);return v;}
function id(v){if(typeof v!=='string')return null;v=v.trim();return v&&v.length<=200?v:null;}
function optionalNumber(v){return typeof v==='number'&&Number.isFinite(v)?v:null;}
function distance(a,b){const r=x=>x*Math.PI/180,dlat=r(b.lat-a.lat),dlng=r(b.lng-a.lng),h=Math.sin(dlat/2)**2+Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dlng/2)**2;return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));}
function longitudeRanges(lng,d){const w=lng-d,e=lng+d;if(w< -180)return[[w+360,180],[-180,e]];if(e>180)return[[w,180],[-180,e-360]];return[[w,e]];}
function urls(p,radius,limit){
  const dy=radius/111320,south=Math.max(-90,p.lat-dy),north=Math.min(90,p.lat+dy),cos=Math.cos(p.lat*Math.PI/180);
  const dx=Math.abs(cos)<1e-6?180:Math.min(180,radius/(111320*Math.abs(cos)));
  return longitudeRanges(p.lng,dx).map(([west,east])=>{const u=new URL('/api/search',ORIGIN);u.searchParams.set('bbox',[west,south,east,north].map(n=>n.toFixed(7)).join(','));u.searchParams.set('limit',String(limit));return u;});
}
function httpsUrl(v){if(typeof v!=='string'||v.length>2048)return null;try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password?u.toString():null;}catch{return null;}}
function licenseOf(i){
  const p=i?.properties||{},raw=typeof p.license==='string'?p.license:typeof i?.license==='string'?i.license:null;
  const licenseId=raw?.trim().slice(0,160)||null,link=Array.isArray(i?.links)?i.links.find(x=>x?.rel==='license'):null,url=httpsUrl(p.license_url||link?.href);
  if(!licenseId&&!url)return null;
  return{id:licenseId,url,displayApproved:licenseId?DISPLAY_LICENSES.has(licenseId.toUpperCase()):false};
}
function pageOf(i){if(!Array.isArray(i?.links))return null;for(const rel of ['via','alternate','self']){const u=httpsUrl(i.links.find(x=>x?.rel===rel)?.href);if(u)return u;}return null;}
function isPanorama(p){
  const projection=String(p?.['Xmp.GPano.ProjectionType']??p?.['xmp:gpano:projection_type']??p?.projection_type??'').trim().toLowerCase();
  return projection==='equirectangular'||optionalNumber(p?.field_of_view??p?.['view:fov'])===360;
}
function normalize(i,target,radius){
  if(!i||typeof i!=='object')return null;
  const pictureId=id(i.id),collectionId=id(i.collection),c=i.geometry?.type==='Point'?i.geometry.coordinates:null;
  if(!pictureId||!collectionId||!Array.isArray(c)||c.length<2||typeof c[0]!=='number'||typeof c[1]!=='number')return null;
  const [lng,lat]=c;if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)return null;
  const meters=distance(target,{lat,lng}),license=licenseOf(i);if(meters>radius||!license)return null;
  const p=i.properties&&typeof i.properties==='object'?i.properties:{};
  const providerNames=Array.isArray(i.providers)
    ? i.providers.filter(entry=>Array.isArray(entry?.roles)&&entry.roles.includes('producer')).map(entry=>id(entry?.name)).filter(Boolean)
    : [];
  const rawProducer=typeof p.producer==='string'?p.producer:typeof p['geovisio:producer']==='string'?p['geovisio:producer']:providerNames.join(', ');
  const producer=rawProducer?.trim().slice(0,200)||null;
  const capturedAt=typeof p.datetime==='string'&&Number.isFinite(Date.parse(p.datetime))?new Date(p.datetime).toISOString():null;
  return{provider:'panoramax',pictureId,collectionId,location:{lat,lng},distanceMeters:Number(meters.toFixed(1)),capturedAt,azimuth:optionalNumber(p['view:azimuth']),mediaType:isPanorama(p)?'panorama_360':'directional_sequence',license,attribution:{provider:'Panoramax',producer},sourcePage:pageOf(i)};
}
async function readJson(response,max){
  const type=response.headers?.get?.('content-type')||'',length=Number(response.headers?.get?.('content-length'));
  if(!/^application\/(?:[^;]+\+)?json\b/i.test(type))throw new Error('Panoramax returned a non-JSON response');
  if(Number.isFinite(length)&&length>max)throw new Error('Panoramax response exceeded the byte limit');
  const reader=response.body?.getReader?.();if(!reader){const text=await response.text();if(Buffer.byteLength(text)>max)throw new Error('Panoramax response exceeded the byte limit');return JSON.parse(text);}
  const chunks=[];let size=0;while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>max){void reader.cancel();throw new Error('Panoramax response exceeded the byte limit');}chunks.push(Buffer.from(part.value));}
  return JSON.parse(Buffer.concat(chunks,size).toString('utf8'));
}
async function lookupPanoramax(location,options={}){
  const target={lat:strictNumber(location?.lat,-90,90,'latitude'),lng:strictNumber(location?.lng,-180,180,'longitude')};
  const radius=integer(options.radiusMeters,100,100,'radius'),limit=integer(options.limit,10,10,'result limit'),timeout=integer(options.timeoutMs,8000,15000,'timeout'),max=integer(options.maximumBytes,MAX_BYTES,MAX_BYTES,'response byte limit');
  const fetchImpl=options.fetchImpl||globalThis.fetch;if(typeof fetchImpl!=='function')throw new TypeError('A fetch implementation is required');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const items=[];
    for(const url of urls(target,radius,limit)){
      const response=await fetchImpl(url,{method:'GET',redirect:'error',headers:{Accept:'application/geo+json, application/json'},signal:controller.signal});
      if(!response||response.status!==200)throw new Error('Panoramax search failed with HTTP '+(response?.status??'unknown'));
      const payload=await readJson(response,max);if(!payload||!Array.isArray(payload.features))throw new Error('Panoramax response has no STAC feature collection');
      items.push(...payload.features.slice(0,limit));if(items.length>=limit)break;
    }
    const seen=new Set(),candidates=items.map(i=>normalize(i,target,radius)).filter(c=>c&&!seen.has(c.pictureId)&&seen.add(c.pictureId)).sort((a,b)=>a.distanceMeters-b.distanceMeters);
    const panoramicMetadata=candidates.filter(c=>c.mediaType==='panorama_360'),panoramas=panoramicMetadata.filter(c=>c.license.displayApproved),directionalSequences=candidates.filter(c=>c.mediaType==='directional_sequence');
    return{available:panoramas.length>0,candidate:panoramas[0]||null,panoramas,panoramicMetadata,directionalSequences,reason:panoramas.length?null:'No explicitly identified, display-licensed 360° Panoramax imagery is available within the configured radius.',queriedRadiusMeters:radius};
  }finally{clearTimeout(timer);}
}
module.exports={lookupPanoramax};
