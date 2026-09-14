import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePanoramaxCandidate } from '../src/lib/panoramax-client.ts';
const fixture = {
 provider: 'panoramax', pictureId: 'picture-1', collectionId: 'sequence-1',
 mediaType: 'panorama_360', capturedAt: '2024-03-01T00:00:00Z', distanceMeters: 25,
 viewerUrl: 'https://api.panoramax.xyz/?focus=pic&pic=picture-1',
 license: { id: 'CC-BY-SA-4.0', url: null, displayApproved: true },
 attribution: { provider: 'Panoramax', producer: 'Example contributor' },
};
test('eligible panorama retains its provider, license and observed distance', () => {
 assert.deepEqual(parsePanoramaxCandidate(fixture), fixture);
});
test('directional imagery stays directional and missing dates stay unknown', () => {
 const result = parsePanoramaxCandidate({ ...fixture, mediaType: 'directional_sequence', capturedAt: null });
 assert.equal(result.mediaType, 'directional_sequence');
 assert.equal(result.capturedAt, null);
});
test('unsafe, unrelated, unlicensed and out-of-range candidates cannot create viewers', () => {
 for (const change of [
  { viewerUrl: 'javascript:alert(1)' },
  { viewerUrl: 'https://unrelated.example/?pic=picture-1' },
  { viewerUrl: 'https://api.panoramax.xyz/?pic=another-picture' },
  { viewerUrl: 'https://secret:password@api.panoramax.xyz/?pic=picture-1' },
  { provider: 'google' }, { distanceMeters: 101 }, { distanceMeters: null },
  { license: { displayApproved: 'true' } }, { license: null },
 ]) assert.equal(parsePanoramaxCandidate({ ...fixture, ...change }), null);
});
