'use strict';

const assert = require('node:assert/strict');
const { test, describe } = require('node:test');
const {
  PropertyTitleClient,
  RISK_BANDS,
  underwriteAuctionTitle
} = require('../server/intelligence/property-title');

describe('PropertyTitle Intelligence & Underwriting', () => {
  const client = new PropertyTitleClient();

  describe('Client Construction & Configuration', () => {
    test('initializes with default credentials and base URL', () => {
      assert.ok(client.apiKey, 'API key should be set');
      assert.ok(client.baseUrl.includes('propertytitle'), 'Base URL should target propertytitle');
    });

    test('supports custom options override', () => {
      const custom = new PropertyTitleClient({
        apiKey: 'custom-key',
        baseUrl: 'https://example.com/api',
        timeout: 5000
      });
      assert.equal(custom.apiKey, 'custom-key');
      assert.equal(custom.baseUrl, 'https://example.com/api');
      assert.equal(custom.timeout, 5000);
    });
  });

  describe('Underwrite Auction Title Risk (Domain Logic)', () => {
    test('classifies Low Risk property and computes cash adders', () => {
      const mockListing = {
        id: 'AUC-101',
        address: '1245 Sunset Blvd',
        openingBid: 100000,
        foreclosureType: 'mortgage_foreclosure'
      };

      const mockAnalysis = {
        property_id: 'PROP-001',
        property_address: '1245 Sunset Blvd, Los Angeles, CA',
        composite_encumbrance_score: 29.3,
        tax_status: { total_balance_due: 12850 },
        hoa_status: { total_due: 10800 },
        active_lien_value: 1480350,
        factor_attribution: { liens: { score: 56.7 } },
        recommendations: ['Pay delinquent taxes: $12,850']
      };

      const result = underwriteAuctionTitle(mockListing, mockAnalysis);

      assert.equal(result.encumbranceScore, 29.3);
      assert.equal(result.riskBand, 'Low Risk');
      assert.equal(result.recommendedAction, 'Proceed with Caution');
      assert.equal(result.lienSurvival.isJuniorForeclosure, false);
      assert.equal(result.lienSurvival.survivingSeniorLiens, 0);
      assert.equal(result.cashToCloseImpact.delinquentTaxes, 12850);
      assert.equal(result.cashToCloseImpact.estimatedTotalAdders, 12850);
      assert.ok(result.curativeRecommendations.length > 0);
    });

    test('detects senior lien survival in junior HOA foreclosures', () => {
      const mockListing = {
        id: 'AUC-102',
        address: '742 Evergreen Terrace',
        openingBid: 25000,
        foreclosureType: 'hoa_lien_foreclosure'
      };

      const mockAnalysis = {
        property_id: 'PROP-002',
        composite_encumbrance_score: 62.0,
        tax_status: { total_balance_due: 5000 },
        active_lien_value: 650000,
        factor_attribution: { liens: { score: 75.0 } }
      };

      const result = underwriteAuctionTitle(mockListing, mockAnalysis);

      assert.equal(result.riskBand, 'High Risk');
      assert.equal(result.lienSurvival.isJuniorForeclosure, true);
      assert.equal(result.lienSurvival.survivingSeniorLiens, 650000);
      // Cash-to-close adders include delinquent taxes + surviving senior mortgage
      assert.equal(result.cashToCloseImpact.estimatedTotalAdders, 655000);
    });

    test('handles empty or missing analysis gracefully', () => {
      const result = underwriteAuctionTitle({ id: 'EMPTY-001' }, {});
      assert.equal(result.encumbranceScore, 0);
      assert.equal(result.riskBand, 'Clean Title');
      assert.equal(result.cashToCloseImpact.estimatedTotalAdders, 0);
    });
  });

  describe('Live PropertyTitle API Integration', () => {
    test('health check returns status ok', async () => {
      const health = await client.healthCheck();
      assert.equal(health.status, 'ok');
      assert.equal(health.service, 'propertytitle');
    });

    test('lists sample properties with pagination', async () => {
      const res = await client.listProperties({ limit: 5 });
      assert.equal(res.ok, true);
      assert.ok(res.data.results.length > 0);
      assert.ok(res.data.results[0].id.startsWith('PROP-'));
    });

    test('analyzes PROP-001 and returns 7-factor composite score', async () => {
      const res = await client.analyzeProperty('PROP-001');
      assert.equal(res.ok, true);
      assert.equal(res.data.property_id, 'PROP-001');
      assert.ok(typeof res.data.composite_encumbrance_score === 'number');
      assert.ok(res.data.factor_attribution);
      assert.ok(res.data.factor_attribution.liens);
      assert.ok(res.data.factor_attribution.tax_liens);
      assert.ok(res.data.recommendations);
    });

    test('retrieves liens and tax status for a property', async () => {
      const liens = await client.listLiens('PROP-001');
      assert.equal(liens.ok, true);
      assert.ok(Array.isArray(liens.data.results));

      const tax = await client.getTaxStatus('PROP-001');
      assert.equal(tax.ok, true);
    });

    test('compares multiple properties in a single call', async () => {
      const comp = await client.compareProperties(['PROP-001', 'PROP-002']);
      assert.equal(comp.ok, true);
    });
  });
});
