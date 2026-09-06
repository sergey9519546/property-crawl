'use strict';

const db = require('../db/client');
const { presentedRunToken, tokensMatch } = require('./scrapers');
const hunts = require('../intelligence/hunts');

const MAX_INVENTORY = 10000;

function createHuntsHandler(dependencies = {}) {
  const database = dependencies.database || db;
  const env = dependencies.env || process.env;
  const filePath = dependencies.filePath;
  const now = () => typeof dependencies.now === 'function' ? dependencies.now() : dependencies.now;
  const durable = dependencies.durableStore || (database.isPg && env.DISCOVERY_MODE === 'advanced' ? require('../discovery/hunt-store').createPgHuntStore(database) : null);

  return async function handleHunts(req, res, urlInput) {
    const url = urlInput instanceof URL ? urlInput : new URL(req.url, 'http://localhost');
    res.setHeader('Cache-Control', 'no-store');
    const configuredToken = String(env.SCRAPER_ADMIN_TOKEN || '').trim();
    if (!configuredToken) return res.status(503).json({
      error: 'Saved hunts need SCRAPER_ADMIN_TOKEN on the API server.',
      requiredConfiguration: 'SCRAPER_ADMIN_TOKEN',
    });
    if (!tokensMatch(presentedRunToken(req), configuredToken)) {
      return res.status(401).json({ error: 'Source operator credential required' });
    }

    try {
      if (durable) {
        if (url.pathname === '/api/hunts' && req.method === 'GET') return res.json({items:await durable.list()});
        if (url.pathname === '/api/hunts' && req.method === 'POST') { const v=hunts.validateHuntInput(req.body||{});if(!v.isValid)throw new hunts.HuntError('HUNT_INVALID','Hunt needs corrections',v.errors);return res.status(201).json({hunt:await durable.create(v.value)}); }
        const durableMatch=url.pathname.match(/^\/api\/hunts\/(hunt_[a-f0-9]{24})(?:\/(events|evaluate))?$/);
        if(durableMatch){const [,id,action]=durableMatch;if(action==='events'&&req.method==='GET')return res.json({items:await durable.events(id,url.searchParams.get('limit'))});if(action==='evaluate'&&req.method==='POST'){const hunt=await durable.get(id);if(!hunt)return res.status(404).json({error:'Hunt was not found'});const inventory=await database.getListings({limit:MAX_INVENTORY,offset:0});if(inventory.total>inventory.listings.length)return res.status(409).json({error:`Hunt evaluation needs a complete inventory of at most ${MAX_INVENTORY} records`});const evaluated=hunts.evaluateInventory(hunt,inventory.listings,{now:now(),previousBaseline:await durable.baseline(id)});return res.json({evaluation:await durable.saveEvaluation(hunt,evaluated)});}if(!action&&req.method==='GET'){const hunt=await durable.get(id);return hunt?res.json({hunt,baseline:await durable.baseline(id),recentEvents:await durable.events(id,20)}):res.status(404).json({error:'Hunt was not found'});}if(!action&&req.method==='PATCH'){const v=hunts.validateHuntInput(req.body||{},{partial:true});if(!v.isValid)throw new hunts.HuntError('HUNT_INVALID','Hunt needs corrections',v.errors);const hunt=await durable.update(id,v.value);return hunt?res.json({hunt}):res.status(404).json({error:'Hunt was not found'});}if(!action&&req.method==='DELETE'){const deleted=await durable.delete(id);return deleted?res.json({deleted:true,id}):res.status(404).json({error:'Hunt was not found'});}}
      }
      if (url.pathname === '/api/hunts') {
        if (req.method === 'GET') return res.json({ items: hunts.listHunts({ filePath }) });
        if (req.method === 'POST') {
          const hunt = hunts.createHunt(req.body || {}, { filePath, now: now() });
          return res.status(201).json({ hunt });
        }
        return res.status(405).json({ error: 'Use GET to list hunts or POST to create one' });
      }

      const match = url.pathname.match(/^\/api\/hunts\/(hunt_[a-f0-9]{24})(?:\/(events|evaluate))?$/);
      if (!match) return res.status(404).json({ error: 'Saved-hunt endpoint not found' });
      const [, id, action] = match;

      if (action === 'events') {
        if (req.method !== 'GET') return res.status(405).json({ error: 'Use GET to read hunt events' });
        return res.json({ items: hunts.listEvents(id, { limit: url.searchParams.get('limit') }, { filePath }) });
      }
      if (action === 'evaluate') {
        if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST to evaluate a hunt' });
        const inventory = await database.getListings({ limit: MAX_INVENTORY, offset: 0 });
        const listings = Array.isArray(inventory) ? inventory : inventory?.listings;
        const total = Array.isArray(inventory) ? inventory.length : Number(inventory?.total);
        if (!Array.isArray(listings)) throw new Error('Listing inventory is unavailable');
        if (Number.isFinite(total) && total > listings.length) {
          return res.status(409).json({ error: `Hunt evaluation needs a complete inventory of at most ${MAX_INVENTORY} records` });
        }
        return res.json({ evaluation: hunts.runHunt(id, listings, { filePath, now: now() }) });
      }

      if (req.method === 'GET') return res.json(hunts.getHunt(id, { filePath }));
      if (req.method === 'PATCH') return res.json({ hunt: hunts.updateHunt(id, req.body || {}, { filePath, now: now() }) });
      if (req.method === 'DELETE') return res.json(hunts.deleteHunt(id, { filePath, now: now() }));
      return res.status(405).json({ error: 'Use GET, PATCH, or DELETE for this hunt' });
    } catch (error) {
      if (error instanceof hunts.HuntError) {
        const status = error.code === 'HUNT_NOT_FOUND' ? 404
          : error.code === 'HUNT_DISABLED' ? 409
            : error.code === 'HUNT_LIMIT' || error.code === 'HUNT_BASELINE_LIMIT' || error.code === 'HUNT_INVENTORY_LIMIT' ? 409 : 400;
        return res.status(status).json({ error: error.message, code: error.code, ...(error.details ? { details: error.details } : {}) });
      }
      console.error('[Saved Hunts]', error.message);
      return res.status(503).json({ error: 'Saved hunts are temporarily unavailable. Existing definitions and baselines were preserved.' });
    }
  };
}

module.exports = createHuntsHandler();
module.exports.createHuntsHandler = createHuntsHandler;
module.exports.MAX_INVENTORY = MAX_INVENTORY;
