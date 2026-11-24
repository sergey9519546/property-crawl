'use strict';

/**
 * server/intelligence/check-ladder.js
 *
 * Courthouse Bid Sheet & Cashier's Check Denomination Ladder Engine.
 *
 * Separates pre-auction wire/ACH escrow commitments (wireLeadHours > 0)
 * from same-day at-gavel certified/cashier's check tenders (wireLeadHours === 0),
 * automatically strikes postponed/canceled/stayed/retired targets, identifies
 * peak simultaneous same-day gavel exposure, and constructs a reusable
 * cashier's check denomination ladder whose subsets can pay every active
 * at-gavel target cleanly without over-tendering by more than $999.
 */

const {
  getAuctionDepositRules,
  optimizeEscrowAllocation,
} = require('./escrow-optimizer');

const DEFAULT_DENOMINATIONS = Object.freeze([100000, 50000, 25000, 10000, 5000, 1000]);
const STRUCK_STATUS_PATTERN = /\b(postponed|adjourned|canceled|cancelled|stayed|retired)\b/i;

/**
 * @typedef {Object} CheckLadderTargetInput
 * @property {string} [id]
 * @property {string} [listingId]
 * @property {string} [address]
 * @property {string} [state]
 * @property {string|null} [county]
 * @property {string} [source]
 * @property {string} [platform]
 * @property {string|null} [saleDate]
 * @property {string|null} [auctionDate]
 * @property {string|null} [status]
 * @property {string|null} [lifecycleStatus]
 * @property {string|null} [lifecycle]
 * @property {string|null} [docketOutcome]
 * @property {string|null} [outcome]
 * @property {boolean} [statutoryStay]
 * @property {boolean} [halted]
 * @property {number|null} [openingBid]
 * @property {number|null} [customOpeningBid]
 * @property {number|null} [maxAllowableOffer]
 * @property {number|null} [maxBid]
 * @property {number|null} [targetBid]
 * @property {number|null} [estimatedMaxBid]
 * @property {number|null} [purchasePrice]
 * @property {number|null} [rehabBudget]
 * @property {number|null} [delinquentTaxes]
 * @property {number|null} [dealScore]
 * @property {number|null} [priorityScore]
 * @property {number|null} [depositPct]
 * @property {number|null} [depositPercent]
 * @property {number|null} [minDeposit]
 * @property {number|null} [minimumDeposit]
 * @property {number|null} [wireLeadHours]
 * @property {number|null} [leadTimeHours]
 * @property {string|null} [bidBasis]
 */

/**
 * @typedef {Object} DenominationLadderRow
 * @property {number} denomination
 * @property {number} count
 * @property {number} subtotal
 */

/**
 * @typedef {Object} CheckSubsetAllocation
 * @property {number} denomination
 * @property {number} count
 * @property {number} subtotal
 */

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function finiteNonNeg(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

/**
 * @param {unknown} value
 * @returns {number|null}
 */
function finitePositive(value) {
  const num = finiteNonNeg(value);
  return num !== null && num > 0 ? num : null;
}

/**
 * Determines whether a target auction must be struck from active capital
 * deployment due to postponement, cancellation, stay, or retirement.
 *
 * @param {CheckLadderTargetInput} target
 * @returns {{ struck: boolean, reason: string|null }}
 */
function classifyTargetStatus(target) {
  if (!target || typeof target !== 'object') {
    return { struck: true, reason: 'Invalid target record' };
  }
  if (target.statutoryStay === true) {
    return { struck: true, reason: 'Statutory stay active' };
  }
  if (target.halted === true) {
    return { struck: true, reason: 'Auction halted' };
  }
  const fields = [
    target.status,
    target.lifecycleStatus,
    target.lifecycle,
    target.docketOutcome,
    target.outcome,
  ]
    .filter((v) => typeof v === 'string' && v.trim())
    .map((v) => v.trim());

  for (const field of fields) {
    const match = field.match(STRUCK_STATUS_PATTERN);
    if (match) {
      return {
        struck: true,
        reason: `Status: ${match[1].toLowerCase()}`,
      };
    }
  }
  return { struck: false, reason: null };
}

/**
 * Extracts a normalized YYYY-MM-DD sale day key for same-day grouping.
 *
 * @param {string|null|undefined} rawDate
 * @param {string} fallbackId
 * @returns {{ saleDate: string|null, saleDay: string, isDated: boolean }}
 */
function normalizeSaleDay(rawDate, fallbackId) {
  if (typeof rawDate === 'string' && rawDate.trim()) {
    const trimmed = rawDate.trim();
    const isoPrefix = trimmed.match(/^(\d{4}-\d{2}-\d{2})/);
    const parsedMs = Date.parse(trimmed);
    if (isoPrefix && Number.isFinite(parsedMs)) {
      return {
        saleDate: new Date(parsedMs).toISOString(),
        saleDay: isoPrefix[1],
        isDated: true,
      };
    }
    if (Number.isFinite(parsedMs)) {
      const iso = new Date(parsedMs).toISOString();
      return {
        saleDate: iso,
        saleDay: iso.slice(0, 10),
        isDated: true,
      };
    }
  }
  return {
    saleDate: null,
    saleDay: `undated:${fallbackId}`,
    isDated: false,
  };
}

/**
 * Resolves the buyer's maximum walk-away bid for deposit sizing.
 * Never fabricates from assessed value or valuation ranges.
 *
 * @param {CheckLadderTargetInput} target
 * @returns {{ maxBid: number, bidBasis: string }}
 */
function resolveTargetMaxBid(target) {
  const candidates = [
    { val: finitePositive(target.maxBid), basis: target.bidBasis || 'yours_max_bid' },
    { val: finitePositive(target.targetBid), basis: target.bidBasis || 'yours_target_bid' },
    { val: finitePositive(target.maxAllowableOffer), basis: 'yours_mao' },
    { val: finitePositive(target.estimatedMaxBid), basis: 'yours_max_bid' },
    { val: finitePositive(target.customOpeningBid), basis: 'yours_opening_bid' },
    { val: finitePositive(target.purchasePrice), basis: 'published_price' },
    { val: finitePositive(target.openingBid), basis: 'published_opening_bid' },
  ];
  for (const c of candidates) {
    if (c.val !== null) {
      return { maxBid: c.val, bidBasis: c.basis };
    }
  }
  return { maxBid: 0, bidBasis: 'unresolved' };
}

/**
 * Rounds an amount up to the nearest $1,000 check increment when > 0.
 *
 * @param {number} amount
 * @returns {number}
 */
function roundUpToCheckUnit(amount) {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.ceil(amount / 1000) * 1000;
}

/**
 * Greedily decomposes an exact amount into the given descending denominations.
 * Returns null remainder if exact decomposition is achieved.
 *
 * @param {number} amount
 * @param {number[]} sortedDenoms
 * @returns {Map<number, number>}
 */
function greedyDecomposeAmount(amount, sortedDenoms) {
  const counts = new Map();
  let remaining = Math.max(0, Math.round(amount));
  for (const d of sortedDenoms) {
    if (d <= 0 || remaining < d) continue;
    const count = Math.floor(remaining / d);
    if (count > 0) {
      counts.set(d, (counts.get(d) || 0) + count);
      remaining -= count * d;
    }
  }
  if (remaining > 0 && sortedDenoms.length > 0) {
    const smallest = sortedDenoms[sortedDenoms.length - 1];
    counts.set(smallest, (counts.get(smallest) || 0) + 1);
  }
  return counts;
}

/**
 * Breaks a denomination d into strictly smaller denominations summing to d.
 * Returns null if d cannot be split exactly.
 *
 * @param {number} denom
 * @param {number[]} sortedDenoms
 * @returns {number[]|null}
 */
function splitDenominationSmaller(denom, sortedDenoms) {
  const smaller = sortedDenoms.filter((x) => x > 0 && x < denom);
  if (smaller.length === 0) return null;

  // Bounded DFS/greedy to decompose `denom` exactly into `smaller`
  /** @type {number[]|null} */
  function search(rem, idx, acc) {
    if (rem === 0) return acc;
    if (idx >= smaller.length) return null;
    const d = smaller[idx];
    const maxCount = Math.floor(rem / d);
    for (let c = maxCount; c >= 0; c -= 1) {
      const nextAcc = c > 0 ? acc.concat(Array(c).fill(d)) : acc;
      const found = search(rem - c * d, idx + 1, nextAcc);
      if (found) return found;
    }
    return null;
  }

  return search(denom, 0, []);
}

/**
 * Attempts to find a subset of checks from `available` (mutating nothing)
 * that sums to `targetAmount` (exact match first; if `allowOverTender` is true,
 * allows minimal over-tender up to `maxOverTender`).
 *
 * @param {number} targetAmount
 * @param {Map<number, number>} available
 * @param {number[]} sortedDenoms
 * @param {{ allowOverTender?: boolean, maxOverTender?: number }} [opts]
 * @returns {{ picked: Map<number, number>, total: number }|null}
 */
function pickSubsetFromAvailable(targetAmount, available, sortedDenoms, opts = {}) {
  const need = Math.max(0, Math.round(targetAmount));
  if (need === 0) return { picked: new Map(), total: 0 };

  const allowOverTender = opts.allowOverTender === true;
  const maxOverTender = Number.isFinite(opts.maxOverTender) ? opts.maxOverTender : 999;

  // Exact match search (largest denominations first)
  /** @param {number} rem @param {number} idx @param {Map<number, number>} acc */
  function findExact(rem, idx, acc) {
    if (rem === 0) return new Map(acc);
    if (idx >= sortedDenoms.length) return null;
    const d = sortedDenoms[idx];
    const avail = available.get(d) || 0;
    const maxTake = Math.min(avail, Math.floor(rem / d));
    for (let c = maxTake; c >= 0; c -= 1) {
      if (c > 0) acc.set(d, c);
      else acc.delete(d);
      const res = findExact(rem - c * d, idx + 1, acc);
      if (res) return res;
    }
    acc.delete(d);
    return null;
  }

  const exact = findExact(need, 0, new Map());
  if (exact) {
    return { picked: exact, total: need };
  }

  if (!allowOverTender) return null;

  // Minimal over-tender within [need, need + maxOverTender]
  let best = null;
  let bestTotal = Infinity;

  /** @param {number} currentSum @param {number} idx @param {Map<number, number>} acc */
  function findMinimalOver(currentSum, idx, acc) {
    if (currentSum >= need) {
      if (currentSum <= need + maxOverTender && currentSum < bestTotal) {
        bestTotal = currentSum;
        best = new Map(acc);
      }
      return;
    }
    if (idx >= sortedDenoms.length) return;
    const d = sortedDenoms[idx];
    const avail = available.get(d) || 0;
    // Upper bound on remaining sum with smaller denominations
    let remCap = 0;
    for (let j = idx; j < sortedDenoms.length; j += 1) {
      remCap += (available.get(sortedDenoms[j]) || 0) * sortedDenoms[j];
    }
    if (currentSum + remCap < need) return;

    const maxTake = Math.min(avail, Math.ceil((need - currentSum) / d));
    for (let c = maxTake; c >= 0; c -= 1) {
      const nextSum = currentSum + c * d;
      if (nextSum > need + maxOverTender && best !== null && nextSum >= bestTotal) continue;
      if (c > 0) acc.set(d, c);
      else acc.delete(d);
      findMinimalOver(nextSum, idx + 1, acc);
    }
    acc.delete(d);
  }

  findMinimalOver(0, 0, new Map());
  return best ? { picked: best, total: bestTotal } : null;
}

/**
 * Tries to assign disjoint subsets from `ladderCounts` to every target in `dayTargets`.
 *
 * @param {Array<{ requiredDeposit: number }>} dayTargets
 * @param {Map<number, number>} ladderCounts
 * @param {number[]} sortedDenoms
 * @param {{ allowOverTender?: boolean, maxOverTender?: number }} [opts]
 * @returns {{ ok: boolean, assignments: Array<{ picked: Map<number, number>, total: number }>, remaining: Map<number, number>, failedTarget?: { requiredDeposit: number } }}
 */
function tryAssignDay(dayTargets, ladderCounts, sortedDenoms, opts = {}) {
  const remaining = new Map(ladderCounts);
  const assignments = [];
  for (const target of dayTargets) {
    const res = pickSubsetFromAvailable(target.requiredDeposit, remaining, sortedDenoms, opts);
    if (!res) {
      return { ok: false, assignments, remaining, failedTarget: target };
    }
    for (const [d, count] of res.picked.entries()) {
      const left = (remaining.get(d) || 0) - count;
      if (left > 0) remaining.set(d, left);
      else remaining.delete(d);
    }
    assignments.push(res);
  }
  return { ok: true, assignments, remaining };
}

/**
 * @param {Map<number, number>} counts
 * @returns {number}
 */
function sumLadderMap(counts) {
  let total = 0;
  for (const [d, c] of counts.entries()) {
    total += d * c;
  }
  return total;
}

/**
 * Converts a denomination count map into a sorted array of { denomination, count, subtotal }.
 *
 * @param {Map<number, number>} counts
 * @param {number[]} sortedDenoms
 * @returns {DenominationLadderRow[]}
 */
function formatLadderMap(counts, sortedDenoms) {
  const rows = [];
  for (const d of sortedDenoms) {
    const count = counts.get(d) || 0;
    if (count > 0) {
      rows.push({
        denomination: d,
        count,
        subtotal: d * count,
      });
    }
  }
  return rows;
}

/**
 * Builds a reusable Cashier's Check Denomination Ladder for all active at-gavel
 * targets, ensuring:
 * 1. Ladder total >= peakAtGavelCheckRequired
 * 2. Every sale day's simultaneous gavel targets can be funded with disjoint subsets
 * 3. Every individual target can be paid without over-tendering by > $999
 *
 * @param {Array<object>} gavelTargets
 * @param {Map<string, Array<object>>} dayGroupsMap
 * @param {number[]} sortedDenoms
 * @returns {{ checkLadder: DenominationLadderRow[], checkLadderTotal: number, peakAtGavelCheckRequired: number, peakSaleDay: string|null, targetAssignments: Map<string, CheckSubsetAllocation[]> }}
 */
function buildReusableCheckLadder(gavelTargets, dayGroupsMap, sortedDenoms) {
  const pricedTargets = gavelTargets.filter((t) => t.requiredDeposit > 0);
  if (pricedTargets.length === 0) {
    return {
      checkLadder: [],
      checkLadderTotal: 0,
      peakAtGavelCheckRequired: 0,
      peakSaleDay: null,
      targetAssignments: new Map(),
    };
  }

  // Sort day groups descending by total required deposit
  const dayEntries = Array.from(dayGroupsMap.entries())
    .map(([day, items]) => {
      const sortedItems = [...items]
        .filter((item) => item.requiredDeposit > 0)
        .sort((a, b) => b.requiredDeposit - a.requiredDeposit);
      const dayTotal = sortedItems.reduce((s, item) => s + item.requiredDeposit, 0);
      return { day, items: sortedItems, dayTotal };
    })
    .filter((entry) => entry.dayTotal > 0)
    .sort((a, b) => b.dayTotal - a.dayTotal);

  const peakEntry = dayEntries[0];
  const peakAtGavelCheckRequired = peakEntry.dayTotal;
  const peakSaleDay = peakEntry.day;

  // Seed ladder from peak day's per-target greedy decomposition
  const ladderCounts = new Map();
  for (const item of peakEntry.items) {
    const itemCounts = greedyDecomposeAmount(item.requiredDeposit, sortedDenoms);
    for (const [d, c] of itemCounts.entries()) {
      ladderCounts.set(d, (ladderCounts.get(d) || 0) + c);
    }
  }

  // Refine ladder so every day group (and therefore every single target) can be paid
  // simultaneously without exceeding +$999 over-tender (ideally exact match).
  for (const entry of dayEntries) {
    let safetyCounter = 0;
    while (safetyCounter < 200) {
      safetyCounter += 1;
      const attempt = tryAssignDay(entry.items, ladderCounts, sortedDenoms, {
        allowOverTender: false,
      });
      if (attempt.ok) break;

      // Determine the smallest check in `remaining` (or `ladderCounts`) that can be split
      // into smaller denominations without increasing total capital.
      const failedNeed = attempt.failedTarget ? attempt.failedTarget.requiredDeposit : 0;
      const remDenomsAsc = Array.from(attempt.remaining.entries())
        .filter(([, c]) => c > 0)
        .map(([d]) => d)
        .sort((a, b) => a - b);

      // Prefer splitting the smallest remaining check > failedNeed, or smallest remaining splittable check
      let splitTarget = null;
      let splitPieces = null;
      for (const candidate of remDenomsAsc) {
        if (candidate > failedNeed) {
          const pieces = splitDenominationSmaller(candidate, sortedDenoms);
          if (pieces) {
            splitTarget = candidate;
            splitPieces = pieces;
            break;
          }
        }
      }
      if (!splitTarget) {
        for (const candidate of remDenomsAsc) {
          const pieces = splitDenominationSmaller(candidate, sortedDenoms);
          if (pieces) {
            splitTarget = candidate;
            splitPieces = pieces;
            break;
          }
        }
      }
      if (!splitTarget) {
        // Check whole ladder if remaining had no splittable checks (e.g. earlier target used a mid check)
        const allDenomsAsc = Array.from(ladderCounts.entries())
          .filter(([, c]) => c > 0)
          .map(([d]) => d)
          .sort((a, b) => a - b);
        for (const candidate of allDenomsAsc) {
          const pieces = splitDenominationSmaller(candidate, sortedDenoms);
          if (pieces) {
            splitTarget = candidate;
            splitPieces = pieces;
            break;
          }
        }
      }

      if (splitTarget && splitPieces) {
        const cur = ladderCounts.get(splitTarget) || 0;
        if (cur > 1) ladderCounts.set(splitTarget, cur - 1);
        else ladderCounts.delete(splitTarget);
        for (const piece of splitPieces) {
          ladderCounts.set(piece, (ladderCounts.get(piece) || 0) + 1);
        }
      } else {
        // Fallback for non-divisible custom denomination sets: try over-tender <= $999
        const overAttempt = tryAssignDay(entry.items, ladderCounts, sortedDenoms, {
          allowOverTender: true,
          maxOverTender: 999,
        });
        if (overAttempt.ok) break;

        // Add smallest denomination needed to cover failedTarget
        const smallestDenom = sortedDenoms[sortedDenoms.length - 1];
        ladderCounts.set(smallestDenom, (ladderCounts.get(smallestDenom) || 0) + 1);
      }
    }
  }

  // Record per-target subset assignments across each day group
  /** @type {Map<string, { subsetChecks: CheckSubsetAllocation[], tenderedAmount: number, overTenderAmount: number }>} */
  const targetAssignments = new Map();
  for (const entry of dayEntries) {
    let res = tryAssignDay(entry.items, ladderCounts, sortedDenoms, {
      allowOverTender: false,
    });
    if (!res.ok) {
      res = tryAssignDay(entry.items, ladderCounts, sortedDenoms, {
        allowOverTender: true,
        maxOverTender: 999,
      });
    }
    if (res.ok) {
      entry.items.forEach((item, idx) => {
        const assigned = res.assignments[idx];
        const subsetChecks = formatLadderMap(assigned.picked, sortedDenoms);
        targetAssignments.set(item.id, {
          subsetChecks,
          tenderedAmount: assigned.total,
          overTenderAmount: Math.max(0, assigned.total - item.exactDeposit),
        });
      });
    }
  }

  const checkLadder = formatLadderMap(ladderCounts, sortedDenoms);
  const checkLadderTotal = sumLadderMap(ladderCounts);

  return {
    checkLadder,
    checkLadderTotal,
    peakAtGavelCheckRequired,
    peakSaleDay,
    targetAssignments,
  };
}

/**
 * Computes the Courthouse Bid Sheet & Cashier's Check Denomination Ladder.
 *
 * @param {object} [params={}]
 * @param {Array<CheckLadderTargetInput>} [params.targets=[]]
 * @param {number|null} [params.availableCapital=null]
 * @param {number[]} [params.denominations=[100000, 50000, 25000, 10000, 5000, 1000]]
 */
function computeCashiersCheckLadder({
  targets = [],
  availableCapital = null,
  denominations = DEFAULT_DENOMINATIONS,
} = {}) {
  const inputTargets = Array.isArray(targets) ? targets : [];
  const cap = finiteNonNeg(availableCapital);

  const sortedDenoms = Array.from(
    new Set(
      (Array.isArray(denominations) && denominations.length > 0 ? denominations : DEFAULT_DENOMINATIONS)
        .map((d) => Math.round(Number(d)))
        .filter((d) => Number.isFinite(d) && d > 0)
    )
  ).sort((a, b) => b - a);
  if (sortedDenoms.length === 0) {
    sortedDenoms.push(...DEFAULT_DENOMINATIONS);
  }

  const activeTargets = [];
  const struckTargets = [];
  const preWireSchedule = [];
  const gavelTargets = [];
  const dayGroupsMap = new Map();

  for (let idx = 0; idx < inputTargets.length; idx += 1) {
    const rawTarget = inputTargets[idx];
    if (!rawTarget || typeof rawTarget !== 'object') continue;
    const id = String(rawTarget.id || rawTarget.listingId || `target_${idx + 1}`);
    const statusInfo = classifyTargetStatus(rawTarget);

    const platformHint = rawTarget.platform || rawTarget.source || 'generic_sheriff';
    const overridePct = finiteNonNeg(rawTarget.depositPct ?? rawTarget.depositPercent);
    const overrideMin = finiteNonNeg(rawTarget.minDeposit ?? rawTarget.minimumDeposit);
    const rule = getAuctionDepositRules(platformHint, {
      state: rawTarget.state || undefined,
      ...(overridePct !== null ? { depositPercent: overridePct } : {}),
      ...(overrideMin !== null ? { minimumDeposit: overrideMin } : {}),
    });

    const wireLeadHoursRaw = finiteNonNeg(rawTarget.wireLeadHours ?? rawTarget.leadTimeHours);
    const wireLeadHours = wireLeadHoursRaw !== null ? wireLeadHoursRaw : rule.leadTimeHours;
    const depositPct = overridePct !== null ? overridePct : rule.depositPercent;
    const minDeposit = overrideMin !== null ? overrideMin : rule.minimumDeposit;

    const { maxBid, bidBasis } = resolveTargetMaxBid(rawTarget);
    const { saleDate, saleDay, isDated } = normalizeSaleDay(rawTarget.saleDate || rawTarget.auctionDate, id);

    if (statusInfo.struck) {
      struckTargets.push({
        id,
        address: rawTarget.address || id,
        state: rawTarget.state || null,
        county: rawTarget.county || null,
        source: rawTarget.source || rule.platform,
        platform: rule.platform,
        saleDate,
        saleDay: isDated ? saleDay : null,
        status: rawTarget.status || rawTarget.lifecycleStatus || rawTarget.lifecycle || null,
        struckReason: statusInfo.reason,
        maxBid,
        bidBasis,
        original: rawTarget,
      });
      continue;
    }

    let exactDeposit = 0;
    if (maxBid > 0) {
      const pctDeposit = Math.ceil(maxBid * depositPct);
      exactDeposit = Math.max(pctDeposit, minDeposit || 0);
      if (Number.isFinite(rule.maximumDeposit) && rule.maximumDeposit !== null && exactDeposit > rule.maximumDeposit) {
        exactDeposit = rule.maximumDeposit;
      }
    }

    const isPreWire = wireLeadHours > 0;
    const requiredDeposit = isPreWire ? exactDeposit : roundUpToCheckUnit(exactDeposit);

    let depositDeadline = null;
    if (saleDate && isPreWire) {
      const deadlineMs = Date.parse(saleDate) - wireLeadHours * 3600 * 1000;
      if (Number.isFinite(deadlineMs)) {
        depositDeadline = new Date(deadlineMs).toISOString();
      }
    }

    const normalizedTarget = {
      id,
      address: rawTarget.address || id,
      state: rawTarget.state || null,
      county: rawTarget.county || null,
      source: rawTarget.source || rule.platform,
      platform: rule.platform,
      ruleLabel: rule.label,
      citation: rule.citation,
      paymentMethod: isPreWire ? (rule.paymentMethod === 'credit_card_hold' ? 'credit_card_hold' : 'wire') : (rule.platform === 'texas_tax' ? 'cashiers_check' : 'certified_funds'),
      saleDate,
      saleDay: isDated ? saleDay : null,
      maxBid,
      bidBasis,
      openingBid: finiteNonNeg(rawTarget.openingBid),
      maxAllowableOffer: finiteNonNeg(rawTarget.maxAllowableOffer),
      rehabBudget: finiteNonNeg(rawTarget.rehabBudget),
      delinquentTaxes: finiteNonNeg(rawTarget.delinquentTaxes),
      depositPct,
      minDeposit,
      wireLeadHours,
      depositDeadline,
      refundTurnaroundDays: rule.refundTurnaroundDays,
      settlementWindowDays: rule.settlementWindowDays,
      exactDeposit,
      requiredDeposit,
      dealScore: finiteNonNeg(rawTarget.dealScore),
      priorityScore: finiteNonNeg(rawTarget.priorityScore),
      original: rawTarget,
    };

    activeTargets.push(normalizedTarget);

    if (isPreWire) {
      preWireSchedule.push(normalizedTarget);
    } else {
      const gavelItem = {
        ...normalizedTarget,
        subsetChecks: [],
        tenderedAmount: 0,
        overTenderAmount: 0,
      };
      gavelTargets.push(gavelItem);
      const groupKey = isDated ? saleDay : `undated:${id}`;
      const existing = dayGroupsMap.get(groupKey) || [];
      existing.push(gavelItem);
      dayGroupsMap.set(groupKey, existing);
    }
  }

  // Sort pre-wire schedule chronologically (earliest wire deadline first)
  preWireSchedule.sort((a, b) => {
    const ta = a.depositDeadline ? Date.parse(a.depositDeadline) : Number.MAX_SAFE_INTEGER;
    const tb = b.depositDeadline ? Date.parse(b.depositDeadline) : Number.MAX_SAFE_INTEGER;
    return ta - tb || a.id.localeCompare(b.id);
  });

  const totalPreWireEscrowRequired = preWireSchedule.reduce((sum, item) => sum + item.requiredDeposit, 0);

  const {
    checkLadder,
    checkLadderTotal,
    peakAtGavelCheckRequired,
    peakSaleDay,
    targetAssignments,
  } = buildReusableCheckLadder(gavelTargets, dayGroupsMap, sortedDenoms);

  // Attach subset allocations back onto gavelTargets
  for (const item of gavelTargets) {
    const assigned = targetAssignments.get(item.id);
    if (assigned) {
      item.subsetChecks = assigned.subsetChecks;
      item.tenderedAmount = assigned.tenderedAmount;
      item.overTenderAmount = assigned.overTenderAmount;
    }
  }

  gavelTargets.sort((a, b) => {
    const ta = a.saleDate ? Date.parse(a.saleDate) : Number.MAX_SAFE_INTEGER;
    const tb = b.saleDate ? Date.parse(b.saleDate) : Number.MAX_SAFE_INTEGER;
    return ta - tb || b.requiredDeposit - a.requiredDeposit || a.id.localeCompare(b.id);
  });

  const totalCapitalRequired = totalPreWireEscrowRequired + checkLadderTotal;
  const capitalShortfall = cap !== null ? Math.max(0, totalCapitalRequired - cap) : null;
  const feasible = cap !== null ? cap >= totalCapitalRequired : null;

  // Build underlying escrow lockup plan via optimizeEscrowAllocation
  const escrowInputs = activeTargets.map((t) => ({
    ...t.original,
    id: t.id,
    source: t.source,
    platform: t.platform,
    state: t.state,
    saleDate: t.saleDate,
    estimatedMaxBid: t.maxBid > 0 ? t.maxBid : undefined,
    openingBid: t.openingBid,
    dealScore: t.dealScore,
    priorityScore: t.priorityScore,
    depositPercent: t.depositPct,
    minimumDeposit: t.minDeposit,
  }));
  const escrowCapitalForPlan = cap !== null ? cap : totalCapitalRequired;
  const escrowPlan = optimizeEscrowAllocation(escrowInputs, escrowCapitalForPlan);

  return {
    summary: {
      activeTargetCount: activeTargets.length,
      struckTargetCount: struckTargets.length,
      totalPreWireEscrowRequired,
      peakAtGavelCheckRequired,
      peakSaleDay,
      checkLadderTotal,
      totalCapitalRequired,
      availableCapital: cap,
      capitalShortfall,
      feasible,
    },
    checkLadder,
    preWireSchedule,
    gavelTargets,
    struckTargets,
    escrowPlan,
  };
}

module.exports = {
  DEFAULT_DENOMINATIONS,
  computeCashiersCheckLadder,
  classifyTargetStatus,
  roundUpToCheckUnit,
};
