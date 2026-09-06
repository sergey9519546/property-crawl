'use strict';

const { nonnegative } = require('./http');

function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}

function monthsBetween(start, end) {
  return Math.max(0, (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth() - (end.getUTCDate() < start.getUTCDate() ? 1 : 0));
}

function amortizedBalance({ principal, originationDate, annualRate, termMonths }, asOf) {
  const p = nonnegative(principal), rate = nonnegative(annualRate), start = parseDate(originationDate), end = parseDate(asOf);
  if (p === null || rate === null || rate > 1 || !Number.isInteger(termMonths) || termMonths < 1 || termMonths > 600 || !start || !end || start > end) return null;
  const months = Math.min(termMonths, monthsBetween(start, end));
  if (months === termMonths) return 0;
  if (rate === 0) return p * (1 - months / termMonths);
  const monthly = rate / 12;
  // This form avoids cancellation when the loan is close to maturity.
  return p * (Math.pow(1 + monthly, termMonths) - Math.pow(1 + monthly, months)) / (Math.pow(1 + monthly, termMonths) - 1);
}

function estimateEquityScenario(input = {}) {
  const unavailable = reason => ({ status: 'unavailable', estimatedValue: null, estimatedDebt: null, estimatedEquity: null, reason, method: 'index_and_amortization_scenario' });
  const basis = nonnegative(input.lastSalePrice), sold = parseDate(input.lastSaleDate), now = parseDate(input.asOf);
  if (!basis || !sold || !now || sold > now) return unavailable('A positive recorded sale basis, valid sale date, and scenario date are required.');
  const then = input.hpiThen, current = input.hpiNow;
  if (!then || !current || !nonnegative(then.value) || !nonnegative(current.value)
    || !then.seriesId || then.seriesId !== current.seriesId || !then.geographyId || then.geographyId !== current.geographyId
    || !parseDate(then.date) || !parseDate(current.date) || parseDate(then.date) > parseDate(current.date)
    || parseDate(current.date) > now) return unavailable('Both HPI anchors must identify the same series and geography, with valid observation dates and positive values.');
  if (parseDate(then.date) > sold || sold - parseDate(then.date) > 92 * 86400000) return unavailable('The sale-side HPI anchor must correspond to the recorded sale month or quarter.');
  if (input.debtKnown !== true || !Array.isArray(input.mortgages)) return unavailable('A documented complete debt scenario is required; missing debt is not zero.');
  const balances = input.mortgages.map(loan => amortizedBalance(loan, input.asOf));
  if (balances.some(value => value === null)) return unavailable('Each mortgage requires its own principal, origination date, rate, and term.');
  const estimatedValue = basis * current.value / then.value;
  const estimatedDebt = balances.reduce((sum, balance) => sum + balance, 0);
  if (!Number.isFinite(estimatedValue) || !Number.isFinite(estimatedDebt)) return unavailable('Scenario inputs exceed the calculation range.');
  return {
    status: 'scenario', estimatedValue: Math.round(estimatedValue), estimatedDebt: Math.round(estimatedDebt),
    estimatedEquity: Math.round(estimatedValue - estimatedDebt), method: 'index_and_amortization_scenario', asOf: input.asOf,
    hpi: { seriesId: then.seriesId, geographyId: then.geographyId, from: then.date, to: current.date },
    assumptions: ['User-supplied HPI and complete debt inputs; not independently verified.', 'Fixed-rate scheduled payments with no missed payments, modifications, advances, fees, or additional liens.', 'Area price changes are applied to the recorded sale basis; property condition and improvements are unknown.'],
    label: 'Illustrative equity scenario; not an appraisal, payoff statement, or verified equity',
  };
}

module.exports = { amortizedBalance, estimateEquityScenario };
