'use strict';
const WAVES=Object.freeze({wave1:Object.freeze(['servicelink','treasury','irs','usda','gsa','hud']),wave2:Object.freeze(['landbank','civilview','bid4assets'])});
// Promotion is gated by DiscoveryStore.promotedSources(), not a static env allowlist.
function sourcesForWave(name){if(!Object.hasOwn(WAVES,name))throw new Error('Unknown discovery wave');return [...WAVES[name]];}
module.exports={WAVES,sourcesForWave};
