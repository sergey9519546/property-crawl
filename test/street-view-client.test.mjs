import test from 'node:test';
import assert from 'node:assert/strict';
import { browserMapsEmbedKey,browserMapsKey,parseStreetViewMetadata,streetViewEmbedUrl,streetViewLaunchUrl } from '../src/lib/street-view-client.ts';

test('interactive metadata is bounded and uses the server supplied panorama binding',()=>{
 const parsed=parseStreetViewMetadata({available:true,provider:'Google Maps',attribution:'Google',panoramaId:'pano-123',panoramaLocation:{lat:34.1,lng:-118.2},targetHeading:271.5,mapsLaunchUrl:'https://www.google.com/maps/@?api=1&map_action=pano&pano=pano-123'});
 assert.equal(parsed.available,true);if(!parsed.available)return;
 assert.equal(parsed.metadata.panoramaId,'pano-123');assert.deepEqual(parsed.metadata.panoramaLocation,{lat:34.1,lng:-118.2});assert.equal(parsed.metadata.heading,271.5);assert.match(streetViewLaunchUrl('10 Main St',parsed.metadata),/^https:\/\/www\.google\.com\/maps\//);
});

test('browser viewer configuration never falls back to the private server key',()=>{
 const previous={server:process.env.GOOGLE_MAPS_API_KEY,js:process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,embed:process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY};
 try{process.env.GOOGLE_MAPS_API_KEY='private-server-key';delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY;assert.equal(browserMapsKey(),null);assert.equal(browserMapsEmbedKey(),null);const parsed=parseStreetViewMetadata({available:true,panoramaId:'pano-123'});assert.equal(parsed.available,true);if(parsed.available)assert.equal(streetViewEmbedUrl(parsed.metadata),null);
 }finally{for(const [key,value] of [['GOOGLE_MAPS_API_KEY',previous.server],['NEXT_PUBLIC_GOOGLE_MAPS_API_KEY',previous.js],['NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY',previous.embed]])value===undefined?delete process.env[key]:process.env[key]=value;}
});

test('embed URL stays off the client even when an embed key is set',()=>{
 const previous=process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY;try{process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY='public-embed-key';const parsed=parseStreetViewMetadata({available:true,panoramaId:'pano-123',heading:42,mapsLaunchUrl:'https://attacker.example/pano'});assert.equal(parsed.available,true);if(!parsed.available)return;assert.equal(parsed.metadata.mapsLaunchUrl,null);assert.equal(browserMapsEmbedKey(),null);assert.equal(streetViewEmbedUrl(parsed.metadata),null);assert.doesNotMatch(streetViewLaunchUrl('10 Main St',parsed.metadata),/attacker|public-embed-key/);}finally{previous===undefined?delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY:process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY=previous;}
});

test('null panorama coordinates stay unavailable and address fallback opens Maps search',()=>{const parsed=parseStreetViewMetadata({available:true,panoramaLocation:{lat:null,lng:null}});assert.equal(parsed.available,true);if(!parsed.available)return;assert.equal(parsed.metadata.panoramaLocation,null);const launch=streetViewLaunchUrl('10 Main Street, Los Angeles, CA',parsed.metadata);assert.match(launch,/\/maps\/search\/\?api=1&query=/);assert.doesNotMatch(launch,/map_action=pano/);});

test('fallback responses from Panoramax and Mapillary populate metadata cleanly', () => {
  const mly = parseStreetViewMetadata({
    available: true,
    provider: 'mapillary_fallback',
    candidate: {
      provider: 'mapillary',
      pictureId: 'mly-1',
      collectionId: 'seq-1',
      mediaType: 'directional_sequence',
      capturedAt: '2025-09-12T12:00:00.000Z',
      distanceMeters: 18.4,
      viewerUrl: 'https://www.mapillary.com/app/?focus=photo&photoId=mly-1',
      thumbUrl: 'https://images.mapillary.com/abc.jpg',
      license: { id: 'CC-BY-SA-4.0', url: 'https://creativecommons.org/licenses/by-sa/4.0/', displayApproved: true },
      attribution: { provider: 'Mapillary', producer: 'contributor' },
    },
  });
  assert.equal(mly.available, true);
  if (!mly.available) return;
  assert.equal(mly.metadata.provider, 'Mapillary');
  assert.equal(mly.metadata.attribution, 'Mapillary · contributor');
  assert.equal(mly.metadata.captureDate, '2025-09');
  assert.equal(mly.metadata.distanceMeters, 18.4);
  assert.equal(mly.metadata.fallbackProvider, 'mapillary');
  assert.ok(mly.metadata.alternativeCandidate);
});
