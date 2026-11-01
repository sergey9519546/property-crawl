'use strict';

/**
 * server/swarm/dag-orchestrator.js
 *
 * Typed Capability Graph DAG Orchestrator (Tier 3.3)
 * Parallel topological DAG execution runner for property enrichment and underwriting triage.
 *
 * Stage pipeline:
 * - Stage 1: geocode (Census Geocoder, inputs: address, situs; outputs: lat, lng, fips)
 * - Stage 2 (Parallel):
 *     - cadastral_parcel (ArcGIS Parcels, inputs: lat, lng, apn; outputs: parcelGeometry, lotAcres) [depends on geocode]
 *     - hpi_benchmark (FHFA HPI, inputs: fips, saleDate; outputs: hpiIndex, hpiAppreciationPct) [depends on geocode]
 *     - hud_safmr (HUD SAFMR, inputs: zip, fips; outputs: fmr0br, fmr1br, fmr2br, fmr3br, fmr4br) [depends on geocode]
 *     - code_enforcement (SODA Municipal Liens, inputs: fips, address; outputs: openViolations, demolitionOrders, superLienFlag) [depends on geocode]
 * - Stage 3: title_risk (Title Risk Engine, inputs: property, superLienFlag; outputs: riskScore, riskFactors) [depends on code_enforcement]
 * - Stage 4: dossier_synthesis (Dossier synthesis combining all outputs) [depends on title_risk, cadastral_parcel, hpi_benchmark, hud_safmr]
 *
 * Features:
 * - Topological dependency resolution and parallel execution per stage via Promise.allSettled
 * - Fault isolation: Optional node failures fail soft without crashing downstream branches
 * - Schema validation for node inputs and outputs
 * - Comprehensive execution telemetry: per-node durationMs, status, errors, and total duration
 */

const { createEnrichmentTriageGraph } = require('./capability-graph');
const { triggerWeightManager } = require('./trigger-weights');
const { computePublicBenchmarkConsensus } = require('../enrichment/public-benchmark-consensus');
const { geocodeAddress } = require('../enrichment/geocoder');
const { queryArcgisParcel } = require('../enrichment/arcgis-parcels');
const { lookupCodeViolations } = require('../enrichment/code-enforcement');
const { getHudSafmrBenchmark } = require('../enrichment/hud-safmr');
const { arbitrateTitleRisk } = require('../intelligence/title-risk-engine');

const DEFAULT_NODE_TIMEOUT_MS = 5000;

/**
 * Node definitions with schemas, dependency declarations, and fault tolerance policies.
 */
const number = (value) => typeof value === 'number' && Number.isFinite(value);
const coordinates = (lat, lng) => number(lat) && number(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 && (lat !== 0 || lng !== 0);
const evidence = (source, observedAt, reason) => ({status: reason ? 'unobserved' : 'source_observed', source, observedAt: observedAt || null, reason: reason || null});
const nullable = (value) => value === null || number(value);
const definition = (name, depends_on, outputs, handler, validateOutput, optional = true) => ({
  name, depends_on, outputs, optional,
  validateInput: ctx => ({valid: Boolean(ctx && typeof ctx === 'object')}),
  validateOutput, defaultHandler: handler,
});
const ENRICHMENT_NODE_DEFS = {
  geocode: definition('geocode', [], ['lat','lng','fips'], async (ctx, options) => {
    let result = coordinates(ctx.lat, ctx.lng) ? {lat:ctx.lat,lng:ctx.lng,fips:ctx.fips,source:'Provided coordinates',timestamp:ctx.sourceObservedAt} : null;
    if (!result && options.allowNetwork === true && (ctx.address || ctx.situs)) result = await geocodeAddress(ctx.address || ctx.situs, {fetchFn:options.fetchFn, signal:options.signal});
    const valid = result && coordinates(result.lat,result.lng);
    return {lat:valid ? result.lat : null,lng:valid ? result.lng : null,fips:valid && /^\d{5}$/.test(result.fips || '') ? result.fips : null, geocodeEvidence:evidence(result?.source || 'US_CENSUS_GEOCODER',result?.timestamp,valid ? null : 'No observed geocode result')};
  }, res => ({valid: Boolean(res && ((coordinates(res.lat,res.lng)) || (res.lat === null && res.lng === null && res.geocodeEvidence?.reason)) && (res.fips === null || /^\d{5}$/.test(res.fips)))}), false),
  cadastral_parcel: definition('cadastral_parcel', ['geocode'], ['parcelGeometry','lotAcres'], async (ctx, options) => {
    const parcel = ctx.parcel || (options.allowNetwork === true ? await queryArcgisParcel({...ctx,signal:options.signal,fetchFn:options.fetchFn}) : null);
    return {parcelGeometry:parcel?.geometry || null,lotAcres:number(parcel?.lotAcres) && parcel.lotAcres >= 0 ? parcel.lotAcres : null,parcelEvidence:evidence(parcel?.source || 'County cadastral records',parcel?.observedAt,parcel ? null : 'Parcel not observed')};
  }, res => ({valid:Boolean(res && nullable(res.lotAcres) && (res.lotAcres === null || res.lotAcres >= 0) && (res.parcelGeometry === null || ['Polygon','MultiPolygon'].includes(res.parcelGeometry?.type)))})),
  hpi_benchmark: definition('hpi_benchmark', ['geocode'], ['hpiIndex','hpiAppreciationPct'], async (ctx, options) => {
    const consensus=computePublicBenchmarkConsensus(ctx,{hpiSeries:options.hpiSeries,currentPeriod:options.currentPeriod});
    const trajectory=consensus.assessedTrajectory;
    return {hpiIndex:trajectory?.currentHpi ?? null,hpiAppreciationPct:trajectory?.hpiAppreciationPct ?? null,hpiEvidence:evidence('FHFA state-quarter series',options.hpiSeries?.retrievedAt,trajectory ? null : consensus.unobservedReasons.join(' '))};
  }, res=>({valid:Boolean(res && nullable(res.hpiIndex) && nullable(res.hpiAppreciationPct))})),
  hud_safmr: definition('hud_safmr', ['geocode'], ['fmr0br','fmr1br','fmr2br','fmr3br','fmr4br'], async ctx => {
    const benchmark=getHudSafmrBenchmark({zip:ctx.zip,bedrooms:2});
    return {...Object.fromEntries([0,1,2,3,4].map(i=>[`fmr${i}br`,benchmark?.bedroomRents?.[i] ?? null])),hudEvidence:evidence(benchmark?.source || 'HUD SAFMR',benchmark?.asOfFiscalYear,benchmark ? null : 'ZIP benchmark unavailable')};
  }, res=>({valid:Boolean(res && [0,1,2,3,4].every(i=>nullable(res[`fmr${i}br`]) && (res[`fmr${i}br`] === null || res[`fmr${i}br`] > 0)))})),
  code_enforcement: definition('code_enforcement', ['geocode'], ['openViolations','demolitionOrders','superLienFlag'], async (ctx, options) => {
    const observed=ctx.municipalRecords || (options.allowNetwork === true ? await lookupCodeViolations({...ctx,signal:options.signal,fetchFn:options.fetchFn}) : null);
    const covered=observed?.evidenceStatus === 'source_observed';
    return {openViolations:covered ? observed.openViolationsCount : null,demolitionOrders:covered ? observed.violations.filter(v=>v.isDemolition || v.isCondemned).length : null,superLienFlag:covered && observed.hasDemolitionRisk === true ? true : null,municipalEvidence:evidence(observed?.source || 'Municipal records',observed?.queriedAt,covered ? null : 'Municipal coverage or query result unobserved')};
  }, res=>({valid:Boolean(res && nullable(res.openViolations) && nullable(res.demolitionOrders) && (res.superLienFlag === null || typeof res.superLienFlag === 'boolean'))})),
  title_risk: definition('title_risk', ['code_enforcement'], ['riskScore','riskFactors'], async ctx => {
    const prop=ctx.property || ctx;
    if (!prop.plaintiff && !prop.raw && !prop.description) return {riskScore:null,riskFactors:['Title evidence is unobserved'],titleEvidence:evidence('Title text patterns',null,'No title evidence')};
    const risk=arbitrateTitleRisk(prop,ctx.noticeText || '');
    return {riskScore:({LOW:20,MODERATE:45,HIGH:70,CRITICAL:90})[risk.riskLevel] ?? null,riskFactors:risk.titleWarnings || [],titleEvidence:{status:'model_derived',source:'Title text patterns',reason:'Pattern signal only; not a title conclusion'}};
  }, res=>({valid:Boolean(res && nullable(res.riskScore) && (res.riskScore === null || (res.riskScore >= 0 && res.riskScore <= 100)) && Array.isArray(res.riskFactors))}),false),
  dossier_synthesis: definition('dossier_synthesis',['title_risk','cadastral_parcel','hpi_benchmark','hud_safmr'],['dossier'],async ctx=>({dossier:{
    synthesizedAt:new Date().toISOString(),address:ctx.address || ctx.situs || null,coordinates:{lat:ctx.lat ?? null,lng:ctx.lng ?? null},fips:ctx.fips ?? null,
    cadastral:{lotAcres:ctx.lotAcres ?? null,hasGeometry:ctx.parcelGeometry ? true : null},
    valuationBenchmarks:{hpiIndex:ctx.hpiIndex ?? null,hpiAppreciationPct:ctx.hpiAppreciationPct ?? null,hudSafmr2br:ctx.fmr2br ?? null},
    codeEnforcement:{openViolations:ctx.openViolations ?? null,demolitionOrders:ctx.demolitionOrders ?? null,superLienFlag:ctx.superLienFlag ?? null},
    titleRisk:{riskScore:ctx.riskScore ?? null,riskFactors:ctx.riskFactors || []},
    evidence:Object.fromEntries(['geocodeEvidence','parcelEvidence','hpiEvidence','hudEvidence','municipalEvidence','titleEvidence'].map(key=>[key,ctx[key] || {status:'unavailable',reason:'Provider did not complete'}])),
  }}),res=>({valid:Boolean(res?.dossier && typeof res.dossier === 'object')}),false),
};

class DagOrchestrator {
  /**
   * @param {Object} [options]
   * @param {CapabilityGraph} [options.graph]
   * @param {Object} [options.nodeDefs]
   * @param {Object} [options.handlers]
   * @param {number} [options.nodeTimeoutMs=5000]
   * @param {TriggerWeightManager} [options.triggerWeights]
   */
  constructor(options = {}) {
    this.graph = options.graph || createEnrichmentTriageGraph();
    this.nodeDefs = options.nodeDefs || { ...ENRICHMENT_NODE_DEFS };
    this.handlers = { ...(options.handlers || {}) };
    this.nodeTimeoutMs = Number.isFinite(options.nodeTimeoutMs) ? options.nodeTimeoutMs : DEFAULT_NODE_TIMEOUT_MS;
    this.triggerWeights = options.triggerWeights || triggerWeightManager;
  }

  /**
   * Registers or overrides a handler for a capability node.
   * @param {string} nodeName
   * @param {Function} handlerFn
   */
  registerHandler(nodeName, handlerFn) {
    if (typeof handlerFn !== 'function') {
      throw new Error(`Handler for "${nodeName}" must be a function`);
    }
    this.handlers[nodeName] = handlerFn;
  }

  /**
   * Resolves topological execution stages for a target or all nodes in the DAG.
   * @param {string} [target='dossier_synthesis']
   * @returns {Array<Array<string>>} List of stages, each containing parallel node names
   */
  compileStages(target = 'dossier_synthesis') {
    const plan = this.graph.buildExecutionPlan(target);
    return plan.stages.map(stage => stage.capabilities.map(c => c.name));
  }

  /**
   * Runs a single node with input validation, timeout protection, output validation, and telemetry.
   *
   * @param {string} nodeName
   * @param {Object} context - Readonly reference to accumulated context
   * @param {Object} options
   * @returns {Promise<Object>} Execution result { success, outputs, durationMs, error? }
   */
  async _executeNode(nodeName, context, options = {}) {
    const def = this.nodeDefs[nodeName] || {
      name: nodeName,
      optional: true,
      validateInput: () => ({ valid: true }),
      validateOutput: () => ({ valid: true }),
      defaultHandler: async () => ({}),
    };

    const handler = options.handlers?.[nodeName] || this.handlers[nodeName] || def.defaultHandler;
    const timeoutMs = Number.isFinite(options.nodeTimeoutMs) ? options.nodeTimeoutMs : this.nodeTimeoutMs;
    const startTime = Date.now();

    // 1. Input Validation
    if (typeof def.validateInput === 'function') {
      const inputVal = def.validateInput(context);
      if (!inputVal.valid) {
        const durationMs = Date.now() - startTime;
        if (def.optional) {
          return {
            nodeName,
            status: 'skipped',
            reason: inputVal.error || 'Input validation failed for optional node',
            durationMs,
            outputs: {},
          };
        }
        return {
          nodeName,
          status: 'failed',
          error: inputVal.error || 'Input validation failed',
          durationMs,
          outputs: {},
        };
      }
    }

    // 2. Execution with Timeout
    let timer;
    const controller = new AbortController();
    try {
      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error(`Node "${nodeName}" timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      });

      const execPromise = Promise.resolve(handler(context, {...options, signal:controller.signal}));
      const rawOutput = await Promise.race([execPromise, timeoutPromise]);

      const durationMs = Date.now() - startTime;

      // 3. Output Validation
      if (typeof def.validateOutput === 'function') {
        const outVal = def.validateOutput(rawOutput);
        if (!outVal.valid) {
          throw new Error(outVal.error || `Output validation failed for node "${nodeName}"`);
        }
      }

      // Calculate non-null yield ratio for trigger weights self-tuning
      const declaredOutputs = def.outputs || Object.keys(rawOutput || {});
      let nonNullCount = 0;
      if (rawOutput && typeof rawOutput === 'object') {
        declaredOutputs.forEach(key => {
          if (rawOutput[key] !== null && rawOutput[key] !== undefined) nonNullCount += 1;
        });
      }
      const yieldRatio = declaredOutputs.length > 0 ? nonNullCount / declaredOutputs.length : 1.0;

      // Self-tune skill trigger weights
      if (this.triggerWeights) {
        this.triggerWeights.recordExecutionOutcome(nodeName, {
          success: true,
          latencyMs: durationMs,
          nonNullYieldRatio: yieldRatio,
        });
      }

      return {
        nodeName,
        status: 'completed',
        durationMs,
        outputs: rawOutput || {},
      };
    } catch (err) {
      const durationMs = Date.now() - startTime;

      // Penalize trigger weights on failure
      if (this.triggerWeights) {
        this.triggerWeights.recordExecutionOutcome(nodeName, {
          success: false,
          latencyMs: durationMs,
          nonNullYieldRatio: 0.0,
        });
      }

      return {
        nodeName,
        status: 'failed',
        error: err.message || String(err),
        durationMs,
        outputs: {},
      };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Executes the entire DAG for the given initial context.
   *
   * @param {Object} initialContext - Starting properties, coordinates, or search terms
   * @param {Object} [options]
   * @param {string} [options.target='dossier_synthesis'] - Target sink node
   * @param {Object} [options.handlers] - Overridden per-node handler functions
   * @param {number} [options.nodeTimeoutMs] - Per-node execution timeout in ms
   * @returns {Promise<Object>} Execution result with accumulated context and telemetry
   */
  async executeDag(initialContext = {}, options = {}) {
    const overallStartTime = Date.now();
    const target = options.target || 'dossier_synthesis';
    const stages = this.compileStages(target);

    const accumulatedContext = { ...initialContext };
    const nodeDiagnostics = {};
    const completedNodes = [];
    const failedNodes = [];
    const skippedNodes = [];
    const blockedByRequired = new Set();
    const stageSummaries = [];

    let overallSuccess = true;

    for (let stageIdx = 0; stageIdx < stages.length; stageIdx++) {
      const stageNodes = stages[stageIdx];
      const stageStartTime = Date.now();

      // Run all independent nodes in this stage concurrently via Promise.allSettled
      const nodePromises = stageNodes.map(nodeName => {
        const def = this.nodeDefs[nodeName];
        // Check if required dependencies were satisfied
        const unmetDep = def?.depends_on?.find(dep => blockedByRequired.has(dep) || ((failedNodes.includes(dep) || skippedNodes.includes(dep)) && !this.nodeDefs[dep]?.optional));
        if (unmetDep) {
          blockedByRequired.add(nodeName);
          return Promise.resolve({
            nodeName,
            status: 'skipped',
            reason: `Required dependency "${unmetDep}" failed`,
            durationMs: 0,
            outputs: {},
          });
        }
        return this._executeNode(nodeName, Object.freeze({ ...accumulatedContext }), options);
      });

      const results = await Promise.allSettled(nodePromises);

      for (const res of results) {
        const item = res.status === 'fulfilled' ? res.value : {
          nodeName: 'unknown',
          status: 'failed',
          error: res.reason?.message || 'Promise rejected',
          durationMs: 0,
          outputs: {},
        };

        const name = item.nodeName;
        nodeDiagnostics[name] = {
          status: item.status,
          durationMs: item.durationMs,
          error: item.error || null,
          reason: item.reason || null,
          outputs: Object.keys(item.outputs || {}),
        };

        if (item.status === 'completed') {
          completedNodes.push(name);
          Object.assign(accumulatedContext, item.outputs);
        } else if (item.status === 'skipped') {
          skippedNodes.push(name);
          if (!this.nodeDefs[name]?.optional) overallSuccess = false;
        } else {
          failedNodes.push(name);
          const def = this.nodeDefs[name];
          if (!def || !def.optional) {
            overallSuccess = false;
          }
        }
      }

      stageSummaries.push({
        stageIndex: stageIdx + 1,
        nodes: stageNodes,
        durationMs: Date.now() - stageStartTime,
        parallel: stageNodes.length > 1,
      });
    }

    const totalDurationMs = Date.now() - overallStartTime;

    return {
      success: overallSuccess,
      context: accumulatedContext,
      stages: stageSummaries,
      telemetry: {
        totalDurationMs,
        completedNodes,
        failedNodes,
        skippedNodes,
        nodeDiagnostics,
      },
    };
  }
}

/**
 * Convenience helper to execute a property enrichment and triage DAG.
 *
 * @param {Object} initialContext
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
async function executeDag(initialContext, options) {
  const orchestrator = new DagOrchestrator(options);
  return orchestrator.executeDag(initialContext, options);
}

module.exports = {
  DEFAULT_NODE_TIMEOUT_MS,
  ENRICHMENT_NODE_DEFS,
  DagOrchestrator,
  executeDag,
};
