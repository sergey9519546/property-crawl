// test/discovery-workbench-page-scope.test.mjs
//
// Same failure shape as test/honest-empty-state.test.js, one level down: the
// discovery workbench reports a page-scoped number as if it were a whole-search
// number. Nothing is broken in the data — the server is answering correctly —
// the labels are what lie.
//
// Three concrete lies this file pins:
//
//   1. The triage chips and distressStage filter only the records already in
//      payload.listings (the server parses neither — see discovery-query.ts).
//      When they emptied a 48-row page out of a search that returns thousands,
//      the old copy still claimed "No listings match your filters. Try a
//      different location", on screen next to "0 of 48 shown": two statements
//      about the same data, one of them false.
//   2. `total` is a whole-search count, except once the post-annotation
//      intelligence view is active (quality/opportunity sort, or minQuality):
//      there the server reports the length of the page it just built. Rendered
//      unqualified, "12 match this search" reads as a total.
//   3. The calendar's unknown-date sentinel begins with "D" and so sorted above
//      every ISO date, putting "Date not published" at the top of the calendar.
//
// Wired into test:evidence-truth alongside the other honesty guards.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const workbench = fs.readFileSync(
  path.join(ROOT, "src/components/listings/discovery-workbench.tsx"),
  "utf8",
);

const UNKNOWN_SALE_DATE = "Date not published";

// --- 1. a page-scoped empty state must not claim an empty search ------------

// The slice covers the whole empty-state ternary, from its condition to the
// source-coverage link that ends the server-empty branch.
function emptyStateBranch() {
  const start = workbench.indexOf("!filteredListings.length ?");
  assert.ok(start > -1, "expected the empty-state branch to still exist");
  const end = workbench.indexOf("View source coverage", start);
  assert.ok(end > start, "expected the server-empty branch to end at its link");
  return workbench.slice(start, end);
}

test("a filter that empties the page says so, instead of claiming no listings match", () => {
  const branch = emptyStateBranch();
  assert.match(
    branch,
    /localFilterActive && pageLength > 0/,
    "the page-scoped message must be chosen by whether a local filter removed rows "
      + "this page actually had; otherwise the server-empty copy claims every "
      + "listing in the search is gone",
  );
  assert.match(
    branch,
    /No listings on this page match this filter\./,
    "an empty page after a local filter is not an empty search and must not read as one",
  );
  assert.match(
    branch,
    /applied to this page only, not to the search/,
    "the message must name the reason the count is page-scoped",
  );
  assert.match(
    branch,
    /Later pages have not been loaded, so matches may be on them\./,
    "the user must be told the unsearched pages are where matches may live",
  );
});

test("the page-scoped empty state offers the way out, not a location the search never filtered on", () => {
  const branch = emptyStateBranch();
  const pageScoped = branch.slice(0, branch.indexOf("No listings match your filters."));
  assert.doesNotMatch(
    pageScoped,
    /Try a different location/,
    "the server-side location filter was never the problem; sending the user "
      + "there to widen a filter that was never applied wastes their time",
  );
  assert.match(pageScoped, /Clear this filter/, "the obvious way out is to clear the local filter");
  assert.match(
    workbench,
    /const clearLocalFilters = React\.useCallback/,
    "the clear action must reset the client-side chips, not just the server query",
  );
  assert.match(workbench, /setTriageFilters\(\{[\s\S]{0,240}stale: false/, "every triage chip is reset");
  assert.match(
    workbench,
    /setFilters\(\{ distressStage: undefined \}\)/,
    "distressStage is applied locally as well and must be cleared too",
  );
});

test("the shown-of-page counter agrees with the page-scoped empty state", () => {
  assert.match(
    workbench,
    /\} shown on this page/,
    "a bare '0 of 48 shown' next to a whole-search claim is how the page "
      + "contradicts itself on screen",
  );
  assert.doesNotMatch(
    workbench,
    /\} shown(?! on this page)/,
    "the counter line must always name the page it counts",
  );
});

test("the genuinely empty search keeps its narrow-filter copy", () => {
  const branch = emptyStateBranch();
  assert.match(branch, /No listings match your filters\./);
  assert.match(branch, /Try a different location or fewer filters\./);
});

// --- 2. a capped count must not wear the label of a search total -----------

test("the intelligence view is detected as the capped-count case", () => {
  assert.match(
    workbench,
    /intelligence\?: \{ sort\?: string \| null; minQuality\?: number/,
    "the client cannot recognise a capped total without the server's own "
      + "intelligence object; its absence here means the check cannot be made",
  );
  assert.match(workbench, /const totalIsPageScoped = Boolean\(/);
  assert.match(
    workbench,
    /payload\.intelligence\?\.sort/,
    "a quality/opportunity sort replaces the search total with the page length",
  );
  assert.match(
    workbench,
    /\(payload\.intelligence\?\.minQuality \|\| 0\) > 0/,
    "any minQuality threshold does the same capping as the intelligence sorts",
  );
  assert.match(
    workbench,
    /payload\.page\?\.hasMore === true && payload\.total <= pageLength/,
    "a total no larger than its own page while more pages exist is a capped "
      + "count even when the server sent no intelligence object to say so",
  );
});

test("a capped count is qualified on screen", () => {
  assert.match(workbench, /match this search/);
  assert.match(
    workbench,
    /totalIsPageScoped \? ", counted on this page only" : ""/,
    '"12 match this search" on a search returning thousands is the defect; the '
      + "copy must say the count covers this page only",
  );
});

// --- 3. the unknown-date sentinel must not head the calendar ---------------

// Loads the comparator out of the component so its ordering is checked by
// running it, not by reading it. Only the two parameter annotations are
// stripped; anything else left behind is a syntax error the assert catches.
// The sentinel is passed in rather than closed over, because the extracted body
// has no access to this module's scope.
function loadComparator() {
  const raw = workbench.match(/function compareSaleDateGroups\([\s\S]*?\n}/);
  assert.ok(
    raw,
    "expected compareSaleDateGroups to exist; a plain localeCompare leaves the "
      + 'position of the "Date not published" bucket to the platform collation',
  );
  const js = raw[0].replace(/\(\s*a:\s*string,\s*b:\s*string\s*\)/, "(a, b)");
  assert.doesNotMatch(js, /:\s*string/, "only the two parameter annotations were expected");
  return new Function("UNKNOWN_SALE_DATE", `${js}; return compareSaleDateGroups;`)(UNKNOWN_SALE_DATE);
}

// A sale date a publisher wrote as a month name rather than an ISO date.
// displayDate returns such a value unchanged (Date.parse fails), so it reaches
// the calendar as a group key like any other.
const LETTER_LED = "January 5, 2026";

test("a letter-led sale date is what floats the unknown bucket to the top", () => {
  // The premise, not the fix. Sorting the raw group keys leaves the unknown
  // bucket wherever the platform collation happens to put the string "Date not
  // published": last against ISO dates, because ICU orders digits before
  // letters, but FIRST against any letter-led value. Neither position is a
  // decision this component made, which is why the comparator exists.
  assert.equal(
    [UNKNOWN_SALE_DATE, LETTER_LED].sort((a, b) => a.localeCompare(b))[0],
    UNKNOWN_SALE_DATE,
    'this locale orders "Date not published" above a month-name date',
  );
  assert.equal(
    [UNKNOWN_SALE_DATE, "2026-01-02"].sort((a, b) => a.localeCompare(b))[0],
    "2026-01-02",
    "and below an ISO date, so the old ordering was locale-dependent rather "
      + "than deliberately unknown-last",
  );
});

test("unknown sale dates sort after every real date, and real dates keep their order", () => {
  const compare = loadComparator();
  const iso = ["2026-03-04", UNKNOWN_SALE_DATE, "2026-01-02", "2026-02-03", UNKNOWN_SALE_DATE];
  assert.deepEqual(
    [...iso].sort(compare),
    ["2026-01-02", "2026-02-03", "2026-03-04", UNKNOWN_SALE_DATE, UNKNOWN_SALE_DATE],
    "ISO dates keep the order localeCompare gave them; unknown buckets collect at the end",
  );
  assert.deepEqual(
    [UNKNOWN_SALE_DATE, LETTER_LED, "2026-01-02"].sort(compare),
    ["2026-01-02", LETTER_LED, UNKNOWN_SALE_DATE],
    "a letter-led date must not push the unknown bucket back to the top",
  );
  assert.ok(compare(UNKNOWN_SALE_DATE, "2026-01-02") > 0, "unknown sorts last");
  assert.ok(compare("2026-01-02", UNKNOWN_SALE_DATE) < 0, "a real date outranks unknown");
  assert.equal(compare("2026-01-02", "2026-03-04") < 0, true, "real dates keep localeCompare order");
  assert.equal(compare(UNKNOWN_SALE_DATE, UNKNOWN_SALE_DATE), 0, "unknown vs unknown is a tie");
});

test("the calendar groups and sorts through the sentinel and the comparator", () => {
  assert.match(workbench, /const UNKNOWN_SALE_DATE = "Date not published";/);
  assert.match(workbench, /listing\.saleDate \|\| UNKNOWN_SALE_DATE/, "grouping uses one sentinel");
  assert.match(
    workbench,
    /\.sort\(\(\[a\], \[b\]\) => compareSaleDateGroups\(a, b\)\)/,
    "the group sort must route through the comparator, not localeCompare directly",
  );
  assert.doesNotMatch(
    workbench,
    /\.sort\(\(\[a\], \[b\]\) => a\.localeCompare\(b\)\)/,
    "sorting raw group keys is the defect: it floats the unknown bucket to the top",
  );
});
