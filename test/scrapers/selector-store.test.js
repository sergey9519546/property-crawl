'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SelectorStore,
  resolveSelector,
  recordSelectorSuccess,
  getCandidateSelectors,
  isAdaptiveAllowed,
  isIdentityOrValuationField,
  FORBIDDEN_FIELDS,
  ALLOWED_PRESENTATION_FIELDS
} = require('../../server/scrapers/selector-store');

test('Adaptive Presentation Selector Store: Policy & Guardrails', async (t) => {
  await t.test('strictly refuses to adapt identity and valuation fields (fails closed)', () => {
    const forbiddenTestFields = ['id', 'address', 'openingBid', 'currentBid', 'caseNumber', 'parcelId', 'apn'];

    for (const field of forbiddenTestFields) {
      assert.equal(
        isIdentityOrValuationField(field),
        true,
        `Field "${field}" must be flagged as identity or valuation`
      );
      assert.equal(
        isAdaptiveAllowed(field),
        false,
        `Field "${field}" must NOT be allowed to adapt`
      );

      // resolveSelector must throw refusal error
      assert.throws(
        () => resolveSelector('civilview', field),
        (err) => {
          assert.equal(err.code, 'ADAPTIVE_SELECTOR_FORBIDDEN');
          assert.ok(err.message.includes('identity/valuation field'));
          return true;
        },
        `Expected resolveSelector to throw refusal for ${field}`
      );

      // recordSelectorSuccess must throw refusal error
      assert.throws(
        () => recordSelectorSuccess('civilview', field, '.selector'),
        (err) => {
          assert.equal(err.code, 'ADAPTIVE_SELECTOR_FORBIDDEN');
          assert.ok(err.message.includes('Cannot record adaptive selector'));
          return true;
        },
        `Expected recordSelectorSuccess to throw refusal for ${field}`
      );
    }
  });

  await t.test('allows non-identity presentation attributes (beds, baths, sqft, propertyType)', () => {
    const allowedFields = ['beds', 'baths', 'sqft', 'propertyType'];

    for (const field of allowedFields) {
      assert.equal(isAdaptiveAllowed(field), true, `Field "${field}" must be allowed to adapt`);
      assert.equal(isIdentityOrValuationField(field), false);
    }
  });
});

test('Selector Resolution & Fallback Selection', async (t) => {
  await t.test('resolves default candidate selectors for presentation fields', () => {
    const store = new SelectorStore({ persist: false });

    const bedsSelector = store.resolveSelector('hud', 'beds');
    assert.equal(typeof bedsSelector, 'string');
    assert.ok(bedsSelector.length > 0);

    const bathsSelector = store.resolveSelector('hud', 'baths');
    assert.equal(typeof bathsSelector, 'string');
    assert.ok(bathsSelector.length > 0);

    const sqftSelector = store.resolveSelector('hud', 'sqft');
    assert.equal(typeof sqftSelector, 'string');
    assert.ok(sqftSelector.length > 0);

    const typeSelector = store.resolveSelector('hud', 'propertyType');
    assert.equal(typeof typeSelector, 'string');
    assert.ok(typeSelector.length > 0);
  });

  await t.test('returns full candidate list and prioritizes newly recorded selector at the head', () => {
    const store = new SelectorStore({ persist: false });
    const initialCandidates = store.getCandidateSelectors('bid4assets', 'beds');

    assert.ok(Array.isArray(initialCandidates));
    assert.ok(initialCandidates.length >= 3);
    const initialHead = initialCandidates[0];

    // Record success for a novel DOM selector discovered during scraping
    const discoveredSelector = '.auction-listing-spec__beds-count';
    store.recordSelectorSuccess('bid4assets', 'beds', discoveredSelector);

    // Resolved selector should now immediately be the discovered selector
    const activeSelector = store.resolveSelector('bid4assets', 'beds');
    assert.equal(activeSelector, discoveredSelector);

    // Candidates list should feature the discovered selector at index 0
    const updatedCandidates = store.getCandidateSelectors('bid4assets', 'beds');
    assert.equal(updatedCandidates[0], discoveredSelector);
    assert.ok(updatedCandidates.includes(initialHead), 'Preserves existing fallbacks');
  });

  await t.test('supports field aliases and canonical normalization', () => {
    const store = new SelectorStore({ persist: false });

    assert.equal(store.resolveSelector('sheriff', 'bedrooms'), store.resolveSelector('sheriff', 'beds'));
    assert.equal(store.resolveSelector('sheriff', 'bathrooms'), store.resolveSelector('sheriff', 'baths'));
    assert.equal(store.resolveSelector('sheriff', 'squareFeet'), store.resolveSelector('sheriff', 'sqft'));
    assert.equal(store.resolveSelector('sheriff', 'propType'), store.resolveSelector('sheriff', 'propertyType'));
  });

  await t.test('standalone functions resolveSelector and recordSelectorSuccess work on default store', () => {
    const defaultBeds = resolveSelector('usda', 'beds');
    assert.ok(defaultBeds);

    recordSelectorSuccess('usda', 'beds', '.custom-usda-beds');
    assert.equal(resolveSelector('usda', 'beds'), '.custom-usda-beds');

    const candidates = getCandidateSelectors('usda', 'beds');
    assert.equal(candidates[0], '.custom-usda-beds');
  });
});
