'use strict';

const COMPARE_LIMIT = 4;

function normalizeCompareIds(value) {
  if (!Array.isArray(value)) return [];
  const ids = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const id = item.trim();
    if (!id || ids.includes(id)) continue;
    ids.push(id);
    if (ids.length === COMPARE_LIMIT) break;
  }
  return ids;
}

function toggleCompareId(current, id) {
  const ids = normalizeCompareIds(current);
  const clean = String(id || '').trim();
  if (!clean) return ids;
  if (ids.includes(clean)) return ids.filter((item) => item !== clean);
  if (ids.length >= COMPARE_LIMIT) return ids;
  return [...ids, clean];
}

function removeCompareId(current, id) {
  const clean = String(id || '').trim();
  return normalizeCompareIds(current).filter((item) => item !== clean);
}

function makeCompareTarget(current, id) {
  const ids = normalizeCompareIds(current);
  const clean = String(id || '').trim();
  if (!ids.includes(clean)) return ids;
  return [clean, ...ids.filter((item) => item !== clean)];
}

module.exports = {
  COMPARE_LIMIT,
  normalizeCompareIds,
  toggleCompareId,
  removeCompareId,
  makeCompareTarget,
};
