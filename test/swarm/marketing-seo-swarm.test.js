'use strict';
/**
 * test/swarm/marketing-seo-swarm.test.js — Verification for Marketing and SEO agents in Swarm.
 */
const assert = require('node:assert/strict');
const { test, describe } = require('node:test');
const config = require('../../scripts/swarm/config');
const { AgentRegistry } = require('../../scripts/swarm/agent-registry');
const { SwarmOrchestrator } = require('../../scripts/swarm/orchestrator');
const { createDefaultGraph } = require('../../scripts/capability-graph');

describe('Marketing & SEO Swarm Agents (Chief of Staff Division)', () => {
  test('config exposes marketing_strategist and seo_specialist agent types', () => {
    assert.ok(config.agentTypes.marketing_strategist, 'missing marketing_strategist agent type');
    assert.ok(config.agentTypes.seo_specialist, 'missing seo_specialist agent type');

    const mkt = config.agentTypes.marketing_strategist;
    assert.ok(mkt.capabilities.includes('synthesize_customer_empathy'));
    assert.ok(mkt.capabilities.includes('map_customer_journey'));
    assert.ok(mkt.capabilities.includes('generate_growth_campaign'));
    assert.equal(typeof mkt.maxConcurrency, 'number');

    const seo = config.agentTypes.seo_specialist;
    assert.ok(seo.capabilities.includes('map_customer_journey'));
    assert.ok(seo.capabilities.includes('optimize_seo_titles_and_serp'));
    assert.ok(seo.capabilities.includes('generate_growth_campaign'));
    assert.ok(seo.capabilities.includes('verify_completion_gate'));
  });

  test('config exposes growth and seo strategies', () => {
    assert.ok(config.strategies.growth, 'missing growth strategy');
    assert.ok(config.strategies.seo, 'missing seo strategy');
    assert.ok(config.strategies.growth.defaultAgents.includes('marketing_strategist'));
    assert.ok(config.strategies.seo.defaultAgents.includes('seo_specialist'));
  });

  test('AgentRegistry attaches playbooks to marketing_strategist and seo_specialist', () => {
    const reg = new AgentRegistry();
    const types = reg.types();

    const mktType = types.find(t => t.name === 'marketing_strategist');
    assert.ok(mktType, 'marketing_strategist type descriptor missing');
    assert.ok(mktType.playbook, 'marketing_strategist playbook not loaded');
    assert.match(mktType.playbook, /Marketing Strategist/);

    const seoType = types.find(t => t.name === 'seo_specialist');
    assert.ok(seoType, 'seo_specialist type descriptor missing');
    assert.ok(seoType.playbook, 'seo_specialist playbook not loaded');
    assert.match(seoType.playbook, /SEO Specialist/);

    const mktAgent = reg.createAgent('marketing_strategist');
    assert.equal(mktAgent.type, 'marketing_strategist');
    assert.ok(mktAgent.playbook);

    const seoAgent = reg.createAgent('seo_specialist');
    assert.equal(seoAgent.type, 'seo_specialist');
    assert.ok(seoAgent.playbook);
  });

  test('capability graph compiles 4-stage sequential plan for growth_campaign_dossier', () => {
    const graph = createDefaultGraph();
    const plan = graph.buildExecutionPlan('growth_campaign_dossier');

    assert.equal(plan.target, 'generate_growth_campaign');
    assert.equal(plan.produces, 'growth_campaign_dossier');
    assert.equal(plan.totalStages, 4);
    assert.equal(plan.totalSteps, 4);

    assert.equal(plan.stages[0].capabilities[0].name, 'synthesize_customer_empathy');
    assert.equal(plan.stages[1].capabilities[0].name, 'map_customer_journey');
    assert.equal(plan.stages[2].capabilities[0].name, 'optimize_seo_titles_and_serp');
    assert.equal(plan.stages[3].capabilities[0].name, 'generate_growth_campaign');
  });

  test('SwarmOrchestrator dry-run generates plan for growth strategy', async () => {
    const orch = new SwarmOrchestrator({ strategy: 'growth', dryRun: true });
    const plan = await orch.run('generate distressed property marketing plan');
    assert.equal(plan.objective, 'generate distressed property marketing plan');
    assert.equal(plan.strategy, 'growth');
    assert.ok(plan.phases.length >= 4);
    assert.ok(plan.phases.some(p => p.name === 'empathy'));
    assert.ok(plan.phases.some(p => p.name === 'journey'));
  });

  test('SwarmOrchestrator dry-run generates plan for seo strategy', async () => {
    const orch = new SwarmOrchestrator({ strategy: 'seo', dryRun: true });
    const plan = await orch.run('optimize property-crawl listing page titles');
    assert.equal(plan.objective, 'optimize property-crawl listing page titles');
    assert.equal(plan.strategy, 'seo');
    assert.ok(plan.phases.length >= 4);
    assert.ok(plan.phases.some(p => p.name === 'title_optimize'));
  });
});
