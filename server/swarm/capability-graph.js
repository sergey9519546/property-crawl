'use strict';

/**
 * server/swarm/capability-graph.js
 *
 * Typed Capability Graph & DAG Dispatch Orchestrator for Swarm Agents.
 * Builds upon and extends scripts/capability-graph.js with property enrichment
 * and underwriting triage node topologies.
 */

const { CapabilityGraph, createDefaultGraph } = require('../../scripts/capability-graph');

/**
 * Creates a CapabilityGraph populated with the Tier 3.3 Property Enrichment
 * and Underwriting Triage capability nodes.
 */
function createEnrichmentTriageGraph() {
  const g = new CapabilityGraph();

  // Stage 1: Geocoding
  g.register({
    name: 'geocode',
    description: 'Census Geocoder & situs resolution',
    inputs: ['address', 'situs'],
    outputs: ['lat', 'lng', 'fips'],
    produces: 'geocoded_location',
    depends_on: [],
    parallelSafe: true,
  });

  // Stage 2: Cadastral parcel geometry (depends on geocode)
  g.register({
    name: 'cadastral_parcel',
    description: 'ArcGIS County & Statewide Cadastral Parcels',
    inputs: ['lat', 'lng', 'apn'],
    outputs: ['parcelGeometry', 'lotAcres'],
    produces: 'cadastral_parcel_boundary',
    depends_on: ['geocode'],
    parallelSafe: true,
  });

  // Stage 2: FHFA House Price Index benchmark (depends on geocode)
  g.register({
    name: 'hpi_benchmark',
    description: 'FHFA House Price Index quarterly appreciation benchmark',
    inputs: ['fips', 'saleDate'],
    outputs: ['hpiIndex', 'hpiAppreciationPct'],
    produces: 'hpi_benchmark_data',
    depends_on: ['geocode'],
    parallelSafe: true,
  });

  // Stage 2: HUD SAFMR Fair Market Rent (depends on geocode)
  g.register({
    name: 'hud_safmr',
    description: 'HUD Small Area Fair Market Rent statutory floor',
    inputs: ['zip', 'fips'],
    outputs: ['fmr0br', 'fmr1br', 'fmr2br', 'fmr3br', 'fmr4br'],
    produces: 'hud_safmr_rents',
    depends_on: ['geocode'],
    parallelSafe: true,
  });

  // Stage 2: Municipal Code Enforcement & Liens (depends on geocode)
  g.register({
    name: 'code_enforcement',
    description: 'SODA Municipal Code Enforcement & Super-Priority Liens',
    inputs: ['fips', 'address'],
    outputs: ['openViolations', 'demolitionOrders', 'superLienFlag'],
    produces: 'code_enforcement_records',
    depends_on: ['geocode'],
    parallelSafe: true,
  });

  // Stage 3: Title Risk Engine (depends on code_enforcement)
  g.register({
    name: 'title_risk',
    description: 'Title Risk & Surviving Senior Lien Arbitration',
    inputs: ['property', 'superLienFlag'],
    outputs: ['riskScore', 'riskFactors'],
    produces: 'title_risk_analysis',
    depends_on: ['code_enforcement'],
    parallelSafe: true,
  });

  // Stage 4: Dossier Synthesis (depends on title_risk, cadastral_parcel, hpi_benchmark, hud_safmr)
  g.register({
    name: 'dossier_synthesis',
    description: 'Property dossier synthesis combining all verified intelligence branches',
    inputs: ['title_risk', 'cadastral_parcel', 'hpi_benchmark', 'hud_safmr'],
    outputs: ['dossier'],
    produces: 'property_dossier',
    depends_on: ['title_risk', 'cadastral_parcel', 'hpi_benchmark', 'hud_safmr'],
    parallelSafe: false,
  });

  return g;
}

module.exports = {
  CapabilityGraph,
  createDefaultGraph,
  createEnrichmentTriageGraph,
};
