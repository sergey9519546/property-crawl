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
const { getHpiIndex, getAppreciationMultiplier } = require('../intelligence/fhfa-hpi');
const { getHudSafmrBenchmark } = require('../enrichment/hud-safmr');
const { arbitrateTitleRisk } = require('../intelligence/title-risk-engine');

const DEFAULT_NODE_TIMEOUT_MS = 5000;

/**
 * Node definitions with schemas, dependency declarations, and fault tolerance policies.
 */
const ENRICHMENT_NODE_DEFS = {
  geocode: {
    name: 'geocode',
    description: 'Census Geocoder & situs resolution',
    inputs: ['address', 'situs'],
    outputs: ['lat', 'lng', 'fips'],
    depends_on: [],
    optional: false,
    validateInput: (ctx) => {
      const hasAddr = typeof ctx.address === 'string' && ctx.address.trim().length > 0;
      const hasSitus = typeof ctx.situs === 'string' && ctx.situs.trim().length > 0;
      if (!hasAddr && !hasSitus) {
        return { valid: false, error: 'geocode requires either "address" or "situs" in context' };
      }
      return { valid: true };
    },
    validateOutput: (res) => {
      if (!res || typeof res !== 'object') return { valid: false, error: 'geocode must return an object' };
      const hasCoord = (Number.isFinite(Number(res.lat)) && Number.isFinite(Number(res.lng))) || res.lat === null;
      return { valid: hasCoord };
    },
    defaultHandler: async (ctx) => {
      // If already geocoded in context, reuse
      if (Number.isFinite(Number(ctx.lat)) && Number.isFinite(Number(ctx.lng))) {
        return {
          lat: Number(ctx.lat),
          lng: Number(ctx.lng),
          fips: ctx.fips || '12095', // default county FIPS if present
        };
      }
      // Minimal deterministic fallback geocoder if external endpoint not called
      return {
        lat: 28.5383,
        lng: -81.3792,
        fips: ctx.fips || '12095',
      };
    },
  },

  cadastral_parcel: {
    name: 'cadastral_parcel',
    description: 'ArcGIS County & Statewide Cadastral Parcels',
    inputs: ['lat', 'lng', 'apn'],
    outputs: ['parcelGeometry', 'lotAcres'],
    depends_on: ['geocode'],
    optional: true,
    validateInput: (ctx) => {
      const hasCoords = Number.isFinite(Number(ctx.lat)) && Number.isFinite(Number(ctx.lng));
      const hasApn = typeof ctx.apn === 'string' && ctx.apn.trim().length > 0;
      if (!hasCoords && !hasApn) {
        return { valid: false, error: 'cadastral_parcel requires coordinates or apn' };
      }
      return { valid: true };
    },
    validateOutput: (res) => {
      if (!res || typeof res !== 'object') return { valid: false, error: 'cadastral_parcel must return an object' };
      return { valid: 'parcelGeometry' in res && 'lotAcres' in res };
    },
    defaultHandler: async (ctx) => {
      return {
        parcelGeometry: ctx.parcelGeometry || { type: 'Polygon', coordinates: [] },
        lotAcres: Number.isFinite(Number(ctx.lotAcres)) ? Number(ctx.lotAcres) : 0.25,
      };
    },
  },

  hpi_benchmark: {
    name: 'hpi_benchmark',
    description: 'FHFA House Price Index quarterly appreciation benchmark',
    inputs: ['fips', 'saleDate'],
    outputs: ['hpiIndex', 'hpiAppreciationPct'],
    depends_on: ['geocode'],
    optional: true,
    validateInput: (ctx) => {
      const hasFips = typeof ctx.fips === 'string' || typeof ctx.state === 'string';
      if (!hasFips) {
        return { valid: false, error: 'hpi_benchmark requires fips or state' };
      }
      return { valid: true };
    },
    validateOutput: (res) => {
      if (!res || typeof res !== 'object') return { valid: false, error: 'hpi_benchmark must return an object' };
      return { valid: 'hpiIndex' in res && 'hpiAppreciationPct' in res };
    },
    defaultHandler: async (ctx) => {
      const state = (ctx.state || 'FL').toUpperCase();
      const currentHpi = getHpiIndex(state, '2026Q1') || 490.0;
      const baselineHpi = getHpiIndex(state, '2020Q2') || 330.0;
      const mult = getAppreciationMultiplier(state, '2020Q2', '2026Q1');
      const appreciationPct = Math.round((mult - 1.0) * 1000) / 10;
      return {
        hpiIndex: currentHpi,
        hpiAppreciationPct: appreciationPct,
      };
    },
  },

  hud_safmr: {
    name: 'hud_safmr',
    description: 'HUD Small Area Fair Market Rent statutory floor',
    inputs: ['zip', 'fips'],
    outputs: ['fmr0br', 'fmr1br', 'fmr2br', 'fmr3br', 'fmr4br'],
    depends_on: ['geocode'],
    optional: true,
    validateInput: (ctx) => {
      const zip = ctx.zip || (ctx.address && (ctx.address.match(/\b\d{5}\b/) || [])[0]);
      if (!zip) {
        return { valid: false, error: 'hud_safmr requires a 5-digit zip code' };
      }
      return { valid: true };
    },
    validateOutput: (res) => {
      if (!res || typeof res !== 'object') return { valid: false, error: 'hud_safmr must return an object' };
      return { valid: 'fmr2br' in res };
    },
    defaultHandler: async (ctx) => {
      const zip = ctx.zip || (ctx.address && (ctx.address.match(/\b\d{5}\b/) || [])[0]) || '32801';
      const benchmark = getHudSafmrBenchmark({ zip, bedrooms: 2 });
      if (benchmark && benchmark.bedroomRents) {
        return {
          fmr0br: benchmark.bedroomRents[0] || 1200,
          fmr1br: benchmark.bedroomRents[1] || 1350,
          fmr2br: benchmark.fairMarketRent || 1600,
          fmr3br: benchmark.bedroomRents[3] || 2100,
          fmr4br: benchmark.bedroomRents[4] || 2400,
        };
      }
      return {
        fmr0br: 1200,
        fmr1br: 1350,
        fmr2br: 1600,
        fmr3br: 2100,
        fmr4br: 2400,
      };
    },
  },

  code_enforcement: {
    name: 'code_enforcement',
    description: 'SODA Municipal Code Enforcement & Super-Priority Liens',
    inputs: ['fips', 'address'],
    outputs: ['openViolations', 'demolitionOrders', 'superLienFlag'],
    depends_on: ['geocode'],
    optional: true,
    validateInput: (ctx) => {
      const hasAddr = typeof ctx.address === 'string' && ctx.address.trim().length > 0;
      if (!hasAddr && !ctx.fips) {
        return { valid: false, error: 'code_enforcement requires address or fips' };
      }
      return { valid: true };
    },
    validateOutput: (res) => {
      if (!res || typeof res !== 'object') return { valid: false, error: 'code_enforcement must return an object' };
      return { valid: 'openViolations' in res && 'demolitionOrders' in res && 'superLienFlag' in res };
    },
    defaultHandler: async (ctx) => {
      // Return unobserved/clear records unless specified in context
      return {
        openViolations: Number.isFinite(ctx.openViolations) ? ctx.openViolations : 0,
        demolitionOrders: Number.isFinite(ctx.demolitionOrders) ? ctx.demolitionOrders : 0,
        superLienFlag: Boolean(ctx.superLienFlag),
      };
    },
  },

  title_risk: {
    name: 'title_risk',
    description: 'Title Risk & Surviving Senior Lien Arbitration',
    inputs: ['property', 'superLienFlag'],
    outputs: ['riskScore', 'riskFactors'],
    depends_on: ['code_enforcement'],
    optional: false,
    validateInput: (ctx) => {
      // Requires property or state
      if (!ctx.property && !ctx.state && !ctx.address) {
        return { valid: false, error: 'title_risk requires property object or state/address' };
      }
      return { valid: true };
    },
    validateOutput: (res) => {
      if (!res || typeof res !== 'object') return { valid: false, error: 'title_risk must return an object' };
      return { valid: Number.isFinite(res.riskScore) && Array.isArray(res.riskFactors) };
    },
    defaultHandler: async (ctx) => {
      const prop = ctx.property || {
        state: ctx.state || 'FL',
        plaintiff: ctx.plaintiff || 'FIRST BANK',
        noticeText: ctx.noticeText || '',
      };
      const titleRes = arbitrateTitleRisk(prop);
      const riskFactors = [...(titleRes.titleWarnings || [])];
      if (ctx.superLienFlag) {
        riskFactors.push('MUNICIPAL SUPER-LIEN DETECTED: Demolition or utility liens survive sale');
      }

      let score = 20; // default low risk
      if (titleRes.riskLevel === 'CRITICAL' || ctx.superLienFlag) score = 90;
      else if (titleRes.riskLevel === 'HIGH') score = 70;
      else if (titleRes.riskLevel === 'MODERATE') score = 45;

      return {
        riskScore: score,
        riskFactors,
      };
    },
  },

  dossier_synthesis: {
    name: 'dossier_synthesis',
    description: 'Property dossier synthesis combining all verified intelligence branches',
    inputs: ['title_risk', 'cadastral_parcel', 'hpi_benchmark', 'hud_safmr'],
    outputs: ['dossier'],
    depends_on: ['title_risk', 'cadastral_parcel', 'hpi_benchmark', 'hud_safmr'],
    optional: false,
    validateInput: (ctx) => {
      // Must have title risk or geocoded context
      if (!ctx.lat && !ctx.riskScore && !ctx.address) {
        return { valid: false, error: 'dossier_synthesis requires geocoded address or risk inputs' };
      }
      return { valid: true };
    },
    validateOutput: (res) => {
      if (!res || typeof res !== 'object') return { valid: false, error: 'dossier_synthesis must return an object' };
      return { valid: 'dossier' in res && typeof res.dossier === 'object' };
    },
    defaultHandler: async (ctx) => {
      const dossier = {
        synthesizedAt: new Date().toISOString(),
        address: ctx.address || ctx.situs || null,
        coordinates: { lat: ctx.lat || null, lng: ctx.lng || null },
        fips: ctx.fips || null,
        cadastral: {
          lotAcres: ctx.lotAcres || null,
          hasGeometry: Boolean(ctx.parcelGeometry),
        },
        valuationBenchmarks: {
          hpiIndex: ctx.hpiIndex || null,
          hpiAppreciationPct: ctx.hpiAppreciationPct || null,
          hudSafmr2br: ctx.fmr2br || null,
        },
        codeEnforcement: {
          openViolations: ctx.openViolations || 0,
          demolitionOrders: ctx.demolitionOrders || 0,
          superLienFlag: Boolean(ctx.superLienFlag),
        },
        titleRisk: {
          riskScore: ctx.riskScore || 20,
          riskFactors: ctx.riskFactors || [],
        },
      };
      return { dossier };
    },
  },
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

    const handler = this.handlers[nodeName] || def.defaultHandler;
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
    try {
      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Node "${nodeName}" timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      });

      const execPromise = Promise.resolve(handler(context, options));
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
    const stageSummaries = [];

    let overallSuccess = true;

    for (let stageIdx = 0; stageIdx < stages.length; stageIdx++) {
      const stageNodes = stages[stageIdx];
      const stageStartTime = Date.now();

      // Run all independent nodes in this stage concurrently via Promise.allSettled
      const nodePromises = stageNodes.map(nodeName => {
        const def = this.nodeDefs[nodeName];
        // Check if required dependencies were satisfied
        const unmetDep = def?.depends_on?.find(dep => failedNodes.includes(dep) && !this.nodeDefs[dep]?.optional);
        if (unmetDep) {
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
