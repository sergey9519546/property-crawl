'use strict';
/**
 * capability-graph.js — Typed Capability Registry & DAG Dispatch Orchestrator.
 *
 * Implements Tier 3.3 of the Agent Architecture Upgrade:
 * Replaces flat description matching with a compiled execution plan.
 * Each capability declares inputs, outputs, dependencies, and produced data products.
 * The orchestrator computes topological execution stages, validates dependencies,
 * and detects cycles.
 *
 * Usage:
 *   node scripts/capability-graph.js                      # Show capability summary
 *   node scripts/capability-graph.js --plan=dossier       # Compile plan for target product
 *   node scripts/capability-graph.js --manifest           # Output full JSON manifest
 *   node scripts/capability-graph.js --check              # Validate graph integrity
 */

class CapabilityGraph {
  constructor() {
    this.capabilities = new Map();
  }

  register(cap) {
    if (!cap.name || typeof cap.name !== 'string') {
      throw new Error('Capability must have a non-empty string name');
    }
    if (this.capabilities.has(cap.name)) {
      throw new Error(`Capability "${cap.name}" is already registered`);
    }

    const normalized = {
      name: cap.name,
      description: cap.description || '',
      inputs: Array.isArray(cap.inputs) ? [...cap.inputs] : [],
      outputs: Array.isArray(cap.outputs) ? [...cap.outputs] : [],
      depends_on: Array.isArray(cap.depends_on) ? [...cap.depends_on] : [],
      produces: cap.produces || cap.name,
      parallelSafe: cap.parallelSafe !== false,
    };

    this.capabilities.set(cap.name, normalized);
    return normalized;
  }

  get(name) {
    return this.capabilities.get(name) || null;
  }

  getAll() {
    return Array.from(this.capabilities.values());
  }

  findByProduct(produces) {
    return this.getAll().filter(c => c.produces === produces);
  }

  validate() {
    const errors = [];
    for (const [name, cap] of this.capabilities.entries()) {
      for (const dep of cap.depends_on) {
        if (!this.capabilities.has(dep)) {
          errors.push(`Capability "${name}" depends on missing capability "${dep}"`);
        }
      }
    }

    // Check for cycles across entire graph
    try {
      this.detectCycles();
    } catch (err) {
      errors.push(err.message);
    }

    return {
      valid: errors.length === 0,
      errors,
      capabilityCount: this.capabilities.size,
    };
  }

  detectCycles() {
    const visited = new Set();
    const inStack = new Set();

    const dfs = (nodeName, path = []) => {
      visited.add(nodeName);
      inStack.add(nodeName);
      const cap = this.capabilities.get(nodeName);
      if (!cap) return;

      for (const dep of cap.depends_on) {
        if (!visited.has(dep)) {
          dfs(dep, [...path, nodeName]);
        } else if (inStack.has(dep)) {
          const cycle = [...path, nodeName, dep].join(' -> ');
          throw new Error(`Cycle detected in capability graph: ${cycle}`);
        }
      }

      inStack.delete(nodeName);
    };

    for (const name of this.capabilities.keys()) {
      if (!visited.has(name)) {
        dfs(name, []);
      }
    }
  }

  /**
   * Compiles a multi-stage execution plan for a given target product or capability.
   * Partitions execution into ordered stages where all nodes in a stage can run in parallel.
   */
  buildExecutionPlan(target) {
    let targetCap = this.capabilities.get(target);
    if (!targetCap) {
      const matching = this.findByProduct(target);
      if (matching.length > 0) {
        targetCap = matching[0];
      }
    }

    if (!targetCap) {
      throw new Error(`Target "${target}" not found as a capability name or produced product`);
    }

    // Collect all reachable nodes via BFS / DFS
    const needed = new Set();
    const collectDeps = (name) => {
      if (needed.has(name)) return;
      needed.add(name);
      const cap = this.capabilities.get(name);
      if (!cap) return;
      for (const dep of cap.depends_on) {
        collectDeps(dep);
      }
    };
    collectDeps(targetCap.name);

    // Calculate in-degree within the sub-graph
    const inDegree = new Map();
    for (const name of needed) {
      inDegree.set(name, 0);
    }
    for (const name of needed) {
      const cap = this.capabilities.get(name);
      for (const dep of cap.depends_on) {
        if (needed.has(dep)) {
          // cap depends on dep, meaning dep must execute before cap
          inDegree.set(name, (inDegree.get(name) || 0) + 1);
        }
      }
    }

    // Kahn's algorithm stratified into parallel stages
    const stages = [];
    let currentStage = [];
    for (const [name, deg] of inDegree.entries()) {
      if (deg === 0) {
        currentStage.push(name);
      }
    }

    const processed = new Set();
    while (currentStage.length > 0) {
      currentStage.sort(); // Deterministic ordering
      stages.push(currentStage.map(name => this.capabilities.get(name)));
      for (const name of currentStage) {
        processed.add(name);
      }

      const nextStage = [];
      for (const name of needed) {
        if (processed.has(name)) continue;
        const cap = this.capabilities.get(name);
        const allDepsSatisfied = cap.depends_on.every(d => !needed.has(d) || processed.has(d));
        if (allDepsSatisfied) {
          nextStage.push(name);
        }
      }
      for (const name of nextStage) {
        processed.add(name);
      }
      currentStage = nextStage;
    }

    if (processed.size !== needed.size) {
      throw new Error(`Failed to resolve all dependencies for target "${target}". Possible cycle.`);
    }

    // Compute required external inputs
    const allProvidedOutputs = new Set();
    for (const stage of stages) {
      for (const node of stage) {
        for (const out of node.outputs) {
          allProvidedOutputs.add(out);
        }
      }
    }

    const externalInputs = new Set();
    for (const stage of stages) {
      for (const node of stage) {
        for (const inp of node.inputs) {
          if (!allProvidedOutputs.has(inp)) {
            externalInputs.add(inp);
          }
        }
      }
    }

    return {
      target: targetCap.name,
      produces: targetCap.produces,
      totalStages: stages.length,
      totalSteps: needed.size,
      requiredInputs: Array.from(externalInputs).sort(),
      stages: stages.map((stage, idx) => ({
        stageIndex: idx + 1,
        parallel: stage.length > 1,
        capabilities: stage.map(c => ({
          name: c.name,
          inputs: c.inputs,
          outputs: c.outputs,
          produces: c.produces
        }))
      }))
    };
  }
}

function createDefaultGraph() {
  const g = new CapabilityGraph();

  g.register({
    name: 'scrape_auctions',
    description: 'Fetch bounded raw records from registered county/state collectors',
    inputs: ['source_identifier', 'collection_options'],
    outputs: ['raw_auction_records'],
    produces: 'raw_records',
    depends_on: []
  });

  g.register({
    name: 'normalize_listings',
    description: 'Project raw publisher records into canonical camelCase listing contract with geocodes',
    inputs: ['raw_auction_records'],
    outputs: ['canonical_listings'],
    produces: 'canonical_listings',
    depends_on: ['scrape_auctions']
  });

  g.register({
    name: 'compute_deal_score',
    description: 'Calculate bounded 1-99 triage Deal Score using SCORE_BANDS taxonomy',
    inputs: ['canonical_listings'],
    outputs: ['scored_listings'],
    produces: 'deal_score',
    depends_on: ['normalize_listings']
  });

  g.register({
    name: 'enrich_public_records',
    description: 'Fetch Florida Cadastral boundaries, assessment roll, and Census ACS context',
    inputs: ['canonical_listings'],
    outputs: ['parcel_geometry', 'tax_assessment', 'census_context'],
    produces: 'public_records_enrichment',
    depends_on: ['normalize_listings']
  });

  g.register({
    name: 'evaluate_opportunity_signals',
    description: 'Extract deterministic reason codes, area contradictions, and triage priority',
    inputs: ['canonical_listings', 'source_observations'],
    outputs: ['opportunity_signals', 'triage_priority'],
    produces: 'opportunity_signals',
    depends_on: ['normalize_listings']
  });

  g.register({
    name: 'generate_property_dossier',
    description: 'Synthesize verified source history, public records, signals, and research gaps',
    inputs: ['canonical_listings', 'parcel_geometry', 'opportunity_signals'],
    outputs: ['property_dossier_json'],
    produces: 'property_dossier',
    depends_on: ['enrich_public_records', 'evaluate_opportunity_signals', 'compute_deal_score']
  });

  g.register({
    name: 'evaluate_saved_hunts',
    description: 'Apply versioned criteria rules with per-clause tri-state explanations',
    inputs: ['canonical_listings', 'hunt_criteria'],
    outputs: ['hunt_matches', 'baseline_diff_events'],
    produces: 'hunt_matches',
    depends_on: ['normalize_listings']
  });

  g.register({
    name: 'verify_completion_gate',
    description: 'Run proportional evidence gate and certify completion with cited test outputs',
    inputs: ['working_tree_diff'],
    outputs: ['completion_block', 'test_evidence'],
    produces: 'completion_certification',
    depends_on: []
  });

  return g;
}

function main() {
  const args = process.argv.slice(2);
  const graph = createDefaultGraph();

  if (args.includes('--check')) {
    const val = graph.validate();
    if (!val.valid) {
      console.error('❌ Capability Graph Validation Failed:');
      val.errors.forEach(e => console.error(`  - ${e}`));
      process.exit(1);
    }
    console.log(`✅ Capability Graph Valid: ${val.capabilityCount} capabilities registered, 0 cycles detected.`);
    process.exit(0);
  }

  if (args.includes('--manifest')) {
    console.log(JSON.stringify(graph.getAll(), null, 2));
    process.exit(0);
  }

  const planArg = args.find(a => a.startsWith('--plan=') || a === '--plan');
  if (planArg) {
    const target = planArg.includes('=') ? planArg.split('=')[1] : args[args.indexOf(planArg) + 1] || 'property_dossier';
    try {
      const plan = graph.buildExecutionPlan(target);
      if (args.includes('--json')) {
        console.log(JSON.stringify(plan, null, 2));
      } else {
        console.log(`=== COMPILED CAPABILITY PLAN: ${plan.target} ===`);
        console.log(`Produces: ${plan.produces}`);
        console.log(`Total Stages: ${plan.totalStages} (${plan.totalSteps} steps)`);
        console.log(`External Inputs Required: ${plan.requiredInputs.join(', ') || 'none'}\n`);
        plan.stages.forEach(stage => {
          const names = stage.capabilities.map(c => c.name).join(', ');
          console.log(`Stage ${stage.stageIndex} ${stage.parallel ? '[PARALLEL]' : '[SEQUENTIAL]'}: ${names}`);
        });
        console.log('==============================================');
      }
      process.exit(0);
    } catch (err) {
      console.error(`❌ Plan generation failed: ${err.message}`);
      process.exit(1);
    }
  }

  // Default summary
  console.log('=== CAPABILITY REGISTRY & GRAPH ===');
  const caps = graph.getAll();
  console.log(`Registered capabilities (${caps.length}):`);
  caps.forEach(c => {
    const deps = c.depends_on.length > 0 ? ` [depends on: ${c.depends_on.join(', ')}]` : '';
    console.log(`  - ${c.name} -> produces: ${c.produces}${deps}`);
  });
  console.log('\nRun with --plan=property_dossier or --check for execution details.');
}

module.exports = { CapabilityGraph, createDefaultGraph };
if (require.main === module) main();
