'use strict';
const WAVES=Object.freeze({wave1:Object.freeze(['servicelink','treasury','irs','usda','gsa','hud']),wave2:Object.freeze(['landbank','civilview','bid4assets'])});
const PROMOTED=new Set(String(process.env.DISCOVERY_PROMOTED_SOURCES||'').split(',').map(x=>x.trim()).filter(Boolean));
function sourcesForWave(name){if(!Object.hasOwn(WAVES,name))throw new Error('Unknown discovery wave');return [...WAVES[name]];}
module.exports={WAVES,PROMOTED,sourcesForWave};
