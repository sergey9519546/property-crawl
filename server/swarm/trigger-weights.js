'use strict';

/**
 * server/swarm/trigger-weights.js
 *
 * Self-Tuning Skill Trigger Weights (Tier 3.4)
 * Dynamically manages routing confidence weights for capability nodes based on
 * historical execution success, latency, and non-null data yield.
 *
 * Clamps weights strictly within bounds [0.1, 1.0].
 */

const MIN_WEIGHT = 0.1;
const MAX_WEIGHT = 1.0;
const DEFAULT_WEIGHT = 1.0;
const DEFAULT_LEARNING_RATE = 0.25;

class TriggerWeightManager {
  /**
   * @param {Object} [options]
   * @param {number} [options.minWeight=0.1]
   * @param {number} [options.maxWeight=1.0]
   * @param {number} [options.defaultWeight=1.0]
   * @param {number} [options.learningRate=0.25]
   */
  constructor(options = {}) {
    this.minWeight = Number.isFinite(options.minWeight) ? options.minWeight : MIN_WEIGHT;
    this.maxWeight = Number.isFinite(options.maxWeight) ? options.maxWeight : MAX_WEIGHT;
    this.defaultWeight = Number.isFinite(options.defaultWeight) ? options.defaultWeight : DEFAULT_WEIGHT;
    this.learningRate = Number.isFinite(options.learningRate) ? options.learningRate : DEFAULT_LEARNING_RATE;

    // Node statistics: { weight, totalCalls, successes, failures, lastLatencyMs, avgYieldRatio }
    this.nodes = new Map();
  }

  /**
   * Clamps a value strictly between minWeight and maxWeight.
   * Snaps within epsilon to minWeight or maxWeight to avoid asymptotic floating point tails.
   *
   * @param {number} val
   * @returns {number}
   */
  clamp(val) {
    if (!Number.isFinite(val)) return this.minWeight;
    let clamped = Math.max(this.minWeight, Math.min(this.maxWeight, val));
    if (Math.abs(clamped - this.minWeight) < 0.005) {
      clamped = this.minWeight;
    } else if (Math.abs(this.maxWeight - clamped) < 0.005) {
      clamped = this.maxWeight;
    }
    return Math.round(clamped * 10000) / 10000;
  }

  /**
   * Retrieves or initializes the state record for a capability.
   * @param {string} capabilityName
   * @returns {Object}
   */
  _getNode(capabilityName) {
    if (!this.nodes.has(capabilityName)) {
      this.nodes.set(capabilityName, {
        weight: this.defaultWeight,
        totalCalls: 0,
        successes: 0,
        failures: 0,
        lastLatencyMs: 0,
        avgYieldRatio: 1.0,
      });
    }
    return this.nodes.get(capabilityName);
  }

  /**
   * Returns the current routing confidence weight for a capability node.
   * Guaranteed to be within [0.1, 1.0].
   *
   * @param {string} capabilityName
   * @returns {number}
   */
  getWeight(capabilityName) {
    if (!capabilityName || typeof capabilityName !== 'string') {
      return this.defaultWeight;
    }
    const node = this._getNode(capabilityName);
    return this.clamp(node.weight);
  }

  /**
   * Records execution outcome for a capability node and self-tunes its weight.
   *
   * @param {string} capabilityName
   * @param {Object} outcome
   * @param {boolean} outcome.success - Whether node execution succeeded
   * @param {number} [outcome.latencyMs] - Execution duration in ms
   * @param {number} [outcome.nonNullYieldRatio] - Ratio of non-null outputs produced (0.0 to 1.0)
   * @returns {number} - New updated weight
   */
  recordExecutionOutcome(capabilityName, outcome = {}) {
    if (!capabilityName || typeof capabilityName !== 'string') {
      throw new Error('capabilityName must be a non-empty string');
    }

    const node = this._getNode(capabilityName);
    node.totalCalls += 1;

    const success = Boolean(outcome.success);
    const latencyMs = Number.isFinite(outcome.latencyMs) ? Math.max(0, outcome.latencyMs) : 0;
    node.lastLatencyMs = latencyMs;

    let targetQuality;

    if (!success) {
      node.failures += 1;
      // On failure, target quality collapses toward minWeight
      targetQuality = this.minWeight;
    } else {
      node.successes += 1;
      const yieldRatio = Number.isFinite(outcome.nonNullYieldRatio)
        ? Math.max(0, Math.min(1.0, outcome.nonNullYieldRatio))
        : 1.0;

      // Update running average yield ratio
      node.avgYieldRatio = ((node.avgYieldRatio * (node.successes - 1)) + yieldRatio) / node.successes;

      // Latency dampener: penalty if latency > 3000ms
      const latencyPenalty = latencyMs > 3000
        ? Math.max(0.6, 1.0 - (latencyMs - 3000) / 10000)
        : 1.0;

      // Quality score based on yield and latency
      targetQuality = (yieldRatio * 0.75 + latencyPenalty * 0.25);
    }

    // Adaptive Exponential Moving Average update
    const alpha = this.learningRate;
    const newWeight = node.weight * (1 - alpha) + targetQuality * alpha;
    node.weight = this.clamp(newWeight);

    return node.weight;
  }

  /**
   * Calibrates a baseline confidence score using the capability's historical weight.
   *
   * @param {string} capabilityName
   * @param {number} baselineConfidence - Baseline confidence between 0.0 and 1.0
   * @returns {number} - Calibrated confidence
   */
  getCalibratedConfidence(capabilityName, baselineConfidence) {
    const baseline = Number.isFinite(baselineConfidence)
      ? Math.max(0.0, Math.min(1.0, baselineConfidence))
      : 0.5;
    const weight = this.getWeight(capabilityName);
    const calibrated = baseline * weight;
    return Math.round(calibrated * 10000) / 10000;
  }

  /**
   * Returns statistics for a capability.
   * @param {string} capabilityName
   * @returns {Object}
   */
  getStats(capabilityName) {
    const node = this._getNode(capabilityName);
    return {
      capabilityName,
      weight: this.clamp(node.weight),
      totalCalls: node.totalCalls,
      successes: node.successes,
      failures: node.failures,
      successRate: node.totalCalls > 0 ? node.successes / node.totalCalls : 1.0,
      lastLatencyMs: node.lastLatencyMs,
      avgYieldRatio: Math.round(node.avgYieldRatio * 10000) / 10000,
    };
  }

  /**
   * Resets weights for one or all capabilities.
   * @param {string} [capabilityName]
   */
  reset(capabilityName) {
    if (capabilityName) {
      this.nodes.delete(capabilityName);
    } else {
      this.nodes.clear();
    }
  }

  /**
   * Exports snapshot of all capability weights.
   * @returns {Object}
   */
  exportWeights() {
    const out = {};
    for (const [name, state] of this.nodes.entries()) {
      out[name] = {
        weight: this.clamp(state.weight),
        totalCalls: state.totalCalls,
        successes: state.successes,
        failures: state.failures,
      };
    }
    return out;
  }

  /**
   * Imports snapshot of capability weights.
   * @param {Object} data
   */
  importWeights(data = {}) {
    if (!data || typeof data !== 'object') return;
    for (const [name, state] of Object.entries(data)) {
      if (state && Number.isFinite(state.weight)) {
        this.nodes.set(name, {
          weight: this.clamp(state.weight),
          totalCalls: Number(state.totalCalls) || 0,
          successes: Number(state.successes) || 0,
          failures: Number(state.failures) || 0,
          lastLatencyMs: 0,
          avgYieldRatio: 1.0,
        });
      }
    }
  }
}

const defaultTriggerWeightManager = new TriggerWeightManager();

module.exports = {
  MIN_WEIGHT,
  MAX_WEIGHT,
  DEFAULT_WEIGHT,
  TriggerWeightManager,
  triggerWeightManager: defaultTriggerWeightManager,
};
