'use strict';

const { cleanText } = require('./http');

function normalizeParcelId(raw) {
  // Keep zeros, punctuation, and internal spacing: changes can identify distinct parcels.
  return typeof raw === 'string' ? cleanText(raw, 120)?.toUpperCase() || null : null;
}

function fips(value, width) {
  const raw = typeof value === 'number' && Number.isInteger(value) ? String(value) : value;
  if (typeof raw !== 'string' || !new RegExp(`^\\d{1,${width}}$`).test(raw)) return null;
  const padded = raw.padStart(width, '0');
  return Number(padded) > 0 ? padded : null;
}

function parcelIdentity({ rawParcelId, stateFips, countyFips, jurisdiction } = {}) {
  const normalizedParcelId = normalizeParcelId(rawParcelId);
  const state = fips(stateFips, 2), county = fips(countyFips, 3);
  const scope = state && county ? `us-fips:${state}${county}` : cleanText(jurisdiction, 100);
  if (!normalizedParcelId || !scope) return null;
  return {
    key: JSON.stringify([scope, normalizedParcelId]), rawParcelId, normalizedParcelId,
    jurisdiction: scope, stateFips: state, countyFips: county, method: 'exact_scoped_parcel_id',
  };
}

function sameParcel(left, right) {
  const a = parcelIdentity(left), b = parcelIdentity(right);
  return Boolean(a && b && a.key === b.key);
}

module.exports = { normalizeParcelId, parcelIdentity, sameParcel, fips };
