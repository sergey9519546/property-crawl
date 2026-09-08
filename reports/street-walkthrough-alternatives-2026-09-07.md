# Street walkthrough alternatives — 2026-09-07

## Recommendation

No reviewed keyless public provider can honestly promise nationwide US coverage. The user subsequently supplied a Maps key, and the app's Google Embed walkthrough was verified with live imagery, rotation, linked-street movement, and return-to-property. No new cloud credential was created. Keep open providers behind coverage gates and use licensed property panoramas where public imagery is absent:

1. **Google Street View**, when the existing metadata gate verifies a nearby outdoor panorama.
2. **Panoramax public/federated instances**, using their keyless STAC read APIs and web viewer where an instance has nearby imagery. Treat each instance as a separate provider and honor the license returned by its landing/configuration response.
3. **KartaView**, as an opportunistic keyless coverage probe behind the same gate, only after a live proof confirms the current nearby-photo and sequence response contract.
4. **MapillaryJS + Mapillary Graph API**, when an application access token becomes available and a server-side proximity/heading gate finds a suitable sequence.
5. **Licensed or user-provided property panoramas**, rendered with Photo Sphere Viewer. This supplies a real navigable property walkthrough where public providers have no coverage, but it does not create street coverage by itself.
6. Keep the current publisher gallery and verified static exterior fallback when none of the interactive providers has a trustworthy match.

Do not build a new Bing Streetside integration. Microsoft still documents Bing’s static Streetside image endpoint, but Bing Maps enterprise customers are being directed to Azure Maps by June 30, 2028, and the reviewed Azure Maps material does not establish an equivalent interactive Streetside panorama product. A static directional image would add another expiring provider without meeting the navigable-walkthrough requirement.

## Live Panoramax federation verification — 2026-09-07

**Decision: keep Panoramax gated and disabled by default.** The public federation is technically usable without a key, but the observed US coverage is too sparse and is often ordinary sequence photography rather than navigable 360 imagery. It can be offered only after a server-side nearby-image probe accepts an actual candidate and labels its media type. It cannot be presented as a dependable fallback for every property.

The live catalog root at `https://api.panoramax.xyz/api` returned HTTP 200 as STAC 1.1.0 and advertised `GET /api/search`, collections, vector tiles, and its OpenAPI document. A request with `Origin: http://localhost:3001` received `Access-Control-Allow-Origin: http://localhost:3001`; a thumbnail from the underlying `panoramax.openstreetmap.fr` instance returned `Access-Control-Allow-Origin: *`. No credential or cookie was sent.

Bounded `GET /api/search?bbox=minLon,minLat,maxLon,maxLat&limit=N` checks produced these results:

| Probe area | Why tested | Returned | Media/navigation evidence | Outcome |
| --- | --- | ---: | --- | --- |
| Potter Valley, California (`-123.20,39.20,-122.95,39.40`) | Town-scale area containing the current Moonbeam Meadow listing | 0 | None | No Panoramax coverage anywhere in the tested town-scale box. The exact listing coordinate was not sent, so exact nearest-image distance remains unverified. |
| Bridgeton, New Jersey (`-75.30,39.38,-75.15,39.52`) | City-scale area for a current GSA property | 0 | None | No observed city-scale coverage. |
| Warwick, Rhode Island (`-71.55,41.62,-71.30,41.82`) | City-scale area for a current GSA property | 100 (request cap) | Returned records were CC BY-SA 4.0 ordinary photos in sequences; sampled records did not declare equirectangular projection or 360° field of view. | Coverage exists in the wider city, but an exact property match and panorama experience are unverified. |
| New Orleans, Louisiana (`-90.20,29.85,-89.90,30.10`) | City-scale area for a current GSA property | 30 | CC BY-SA 4.0 records from `mapcomplete` and `osm-fr`; sampled metadata did not establish 360° imagery. | Sparse wider-city coverage; exact property match unverified. |
| Penrose, Colorado (`-105.05,38.35,-104.90,38.50`) | Town-scale area for a current Treasury property | 0 | None | No observed town-scale coverage. |
| Midtown Manhattan (`-74.10,40.65,-73.85,40.85`) | Known-covered US control | 10 (request cap) | A sampled CC BY-SA 4.0 Pixel 3a image had working `next`/`prev` STAC links. Fetching the next item returned its own adjacent links. No equirectangular projection or 360° field of view was declared. | Confirms keyless US sequence navigation and asset delivery, but as ordinary directional photography. |
| Central Paris (`2.33,48.85,2.36,48.87`) | Known-covered 360 control | 5 (request cap) | Sampled item declared `Xmp.GPano.ProjectionType=equirectangular`, `field_of_view=360`, adjacent links, tiled imagery, and Etalab 2.0 license. | Confirms that the federation and viewer can support true 360 sequences when the source imagery provides them. |

The search response contains the normalization fields needed by the proposed adapter: item ID, collection/sequence ID, point geometry, capture `datetime`, `view:azimuth`, original-instance `via` link, `prev`/`next` links with neighboring coordinates, image assets, producer, license link/property, and camera metadata. A 360 candidate must explicitly declare equirectangular projection or a 360° field of view; the presence of adjacent links alone means only that an ordinary-photo sequence is navigable.

The automatic approval review rejected transmitting the exact Moonbeam Meadow coordinate derived from the local inventory to the external Panoramax API. The safer town-scale probe above therefore establishes an absence across a much larger surrounding box without claiming an exact-distance result. Exact-coordinate probes should run only when the product request itself authorizes sending that listing coordinate to the selected external provider.

Reproduction commands used no authentication and requested metadata or one thumbnail only:

```powershell
Invoke-WebRequest -UseBasicParsing -Uri 'https://api.panoramax.xyz/api' -Headers @{ Origin = 'http://localhost:3001' }
Invoke-WebRequest -UseBasicParsing -Uri 'https://api.panoramax.xyz/api/search?bbox=-123.20,39.20,-122.95,39.40&limit=10' -Headers @{ Origin = 'http://localhost:3001' }
Invoke-WebRequest -UseBasicParsing -Uri 'https://api.panoramax.xyz/api/search?bbox=-74.10,40.65,-73.85,40.85&limit=10' -Headers @{ Origin = 'http://localhost:3001' }
Invoke-WebRequest -UseBasicParsing -Uri 'https://api.panoramax.xyz/api/search?bbox=2.33,48.85,2.36,48.87&limit=5' -Headers @{ Origin = 'http://localhost:3001' }
```

## What each project actually provides

| Candidate | Imagery dataset? | Navigable viewer? | Practical finding |
| --- | --- | --- | --- |
| [Mapillary](https://www.mapillary.com/developer/api-documentation/) / [MapillaryJS](https://github.com/mapillary/mapillary-js) | Yes, crowdsourced street-level images and sequences | Yes. MapillaryJS has spatial and sequence navigation; Mapillary documents spatial, sequence, and playback arrows. | Strongest reviewed hosted alternative when a token is available, but it is not keyless. Graph API access requires an application/access token. The viewer is MIT, while imagery/API use follows Mapillary Terms and Commercial Terms and requires attribution. Coverage is crowdsourced; verify per property. |
| [KartaView](https://kartaview.org/) / [openstreetcam.org repo](https://github.com/kartaview/openstreetcam.org) | Yes, crowdsourced street images/tracks | The hosted site has sequence-style viewing; repository is a full web application rather than a clean embeddable viewer SDK. | Useful second probe, but API documentation and reliability are weaker. The project terms license code under MIT and imagery/3D spatial data under CC BY-SA 4.0. The main web repo was last shown updated April 2025; there is no evidence here of broad current US coverage. |
| [Panoramax](https://docs.panoramax.fr/) / [web viewer](https://gitlab.com/panoramax/clients/web-viewer) | Yes, federated instance datasets exposed through STAC/OGC APIs | Yes. The current viewer supports map + photo, sequence/picture selection, and directional movement. | Best keyless prototype. Public instances may expose read APIs without a token; upload/authentication policy remains instance-specific. Web viewer 5.2.0 was tagged August 3, 2026. Query federation/instance metadata and verify coverage at runtime. Each instance declares one image license. No evidence supports nationwide US coverage. |
| [Photo Sphere Viewer](https://github.com/mistic100/Photo-Sphere-Viewer) | No | Yes, including virtual tours, links/hotspots, maps, and multiple panorama nodes | Preferred viewer for licensed/user-provided property panoramas. MIT and visibly active through 2026 (5.14.2 announcement in June 2026). It needs our own equirectangular/cubemap assets and tour graph. |
| [Pannellum](https://github.com/mpetroff/pannellum) | No | Yes, tours/scenes and hotspots | Strong smaller fallback viewer. MIT; release 2.5.7 dated February 19, 2026. Good if bundle size and simple JSON tours matter more than the richer Photo Sphere Viewer plugin model. |
| [Marzipano](https://github.com/google/marzipano) | No | Yes, scenes, tiled panoramas, transitions, and hotspots | Capable, but lower choice for new work. The repository says it is not an official Google product; its changelog’s latest listed release is 0.10.2 from March 2021. |
| [Bing Maps Streetside REST](https://learn.microsoft.com/en-us/bingmaps/rest-services/imagery/get-a-static-map) | Yes, proprietary | The reviewed REST API returns static directional images, not the required embedded adjacent-frame walkthrough | Do not prioritize. Requires a Bing Maps key and carries a migration deadline. Reconsider only if Microsoft publishes a supported Azure Maps interactive Streetside replacement and commercial terms fit. |

## Provider-contract architecture for this repository

The current Google path already has the right trust boundary in `server/routes/property-image.js` and `src/lib/street-view-client.ts`: it starts from a source-observed listing, resolves exact coordinates, measures panorama distance, computes the bearing from panorama to property, retains capture date and attribution, and exposes a provider panorama ID without persisting imagery.

Generalize that metadata shape instead of letting each UI invent its own matching rules:

```ts
type WalkthroughCandidate = {
  provider: "google" | "mapillary" | "kartaview" | "panoramax" | "property-tour";
  panoramaId: string;
  sequenceId: string | null;
  location: { lat: number; lng: number };
  targetHeading: number | null;
  captureDate: string | null;
  distanceMeters: number;
  attribution: { label: string; url: string; license?: string };
  navigation: "spatial" | "sequence" | "tour-graph";
  sourceUrl: string;
};
```

Each adapter should implement `probe({lat,lng,radiusMeters})` and return candidates only. The existing server gate should then apply shared rules: valid exact listing coordinates, a tight configurable radius, distance measurement on the server, capture metadata retention, required attribution/license, HTTPS allowlist, and no approximate-address substitution. Provider absence, throttling, or a challenge must fall through without becoming evidence of no property or no exterior.

For Mapillary, query a very small bounding box around the property for `id`, `geometry` or computed geometry, `captured_at`, `compass_angle`, `camera_type`, and `sequence`; rank by distance, heading toward the parcel, recency, and panoramic camera type. Initialize MapillaryJS with the selected image ID and let its data provider handle adjacent spatial/sequence navigation. Register the token server-side where possible; if the browser viewer requires a client token, use a restricted application token and never treat it as a secret.

For KartaView and Panoramax, ship them disabled until live probes demonstrate the nearby-search response contract, attribution, CORS behavior, latency, and meaningful coverage on a representative US property sample. Panoramax is easier to normalize because the API follows STAC and its viewer accepts an instance endpoint, sequence ID, and picture ID. KartaView needs an adapter around its hosted API; do not bind the UI directly to undocumented response fields.

For property-owned panoramas, store a tour manifest rather than image assumptions: licensed asset URLs, capture timestamp, uploader/source, panorama coordinates, initial heading, and explicit node links. Photo Sphere Viewer’s virtual-tour plugin can preload the next linked node and render navigation arrows. Generate responsive multi-resolution tiles at ingestion time and serve immutable CDN/object-storage assets. This is the only option in the set that can guarantee a walkthrough for a particular property, because the application controls capture and hosting.

## Loading and operational limits

- Probe providers server-side in priority order with short timeouts and circuit breakers. Cache only normalized availability metadata briefly; follow each provider’s terms for image caching.
- Start rendering after the first accepted candidate. Preload only the selected image plus one or two adjacent frames/nodes. Do not crawl or bulk-download street imagery.
- Keep provider-specific tokens, quotas, and retry headers inside adapters. Mapillary’s public material reviewed here does not give a dependable universal request-per-minute number, so instrument 429s and configure a conservative local budget rather than inventing a rate limit.
- Attribute every displayed frame. For KartaView that includes CC BY-SA 4.0 obligations. For Panoramax read the instance license instead of assuming one federation-wide license.
- Record provider, panorama/picture ID, sequence ID, distance, coordinate basis, capture date, and probe timestamp. Do not infer current property condition from historical imagery.
- Coverage claims must come from measured probes against this application’s actual inventory. Repository activity and global project descriptions do not establish nationwide US coverage.

## Primary evidence reviewed

- [MapillaryJS repository and MIT license](https://github.com/mapillary/mapillary-js)
- [Mapillary API demo showing access-token, image, sequence, and coverage-layer flows](https://mapillary.github.io/api-demo/)
- [Mapillary navigation documentation](https://help.mapillary.com/hc/en-us/articles/115001770409-Navigating-Mapillary)
- [Mapillary data-use guidance referencing Terms and Commercial Terms](https://help.mapillary.com/hc/en-us/articles/4407521157138-Downloading-map-data-via-the-Mapillary-web-app)
- [KartaView organization and repository activity](https://github.com/kartaview)
- [KartaView terms: MIT software and CC BY-SA 4.0 imagery](https://kartaview.org/terms)
- [Panoramax STAC/OGC API documentation](https://docs.panoramax.fr/backend/api/api/)
- [Panoramax viewer API](https://docs.panoramax.fr/web-viewer/reference/components/core/Viewer/)
- [Panoramax hosting/federation model](https://docs.panoramax.fr/how-to-contribute/hosting-instance/)
- [Panoramax per-instance image licensing](https://docs.panoramax.fr/backend/install/settings/)
- [Panoramax web-viewer release tags](https://gitlab.com/panoramax/clients/web-viewer/-/tags)
- [Photo Sphere Viewer repository](https://github.com/mistic100/Photo-Sphere-Viewer)
- [Pannellum repository and releases](https://github.com/mpetroff/pannellum)
- [Marzipano repository](https://github.com/google/marzipano)
- [Microsoft Bing Streetside static imagery documentation and migration notice](https://learn.microsoft.com/en-us/bingmaps/rest-services/imagery/get-a-static-map)

## Evidence gaps before implementation

1. Register a Mapillary test application and probe a representative, stratified sample of verified US listing coordinates. Measure hit rate within the same distance threshold used for Google, capture age, 360-image share, sequence length, latency, and 429 behavior.
2. Run the same sample against KartaView and the Panoramax federated catalog/selected instances. A successful homepage or city demo is not coverage evidence.
3. Review current commercial/API terms with the intended production use, especially image proxying/caching and required attribution. Open-source viewer licenses do not license imagery.
4. Decide whether property panoramas will be publisher-supplied, owner/agent uploaded, or commissioned. The viewer is straightforward; capture rights, moderation, storage, tiling, and retention are the substantive product work.
