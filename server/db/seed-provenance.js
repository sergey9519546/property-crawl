const { validateListingForIngestion } = require('../scrapers/validation');

// Decide whether a record belongs in the current live inventory. Returns the
// live provenance when the record passed ingestion AND was observed against a
// real source record. Returns null for snapshots, fixtures, demos, and any
// record whose source URL points at the publisher homepage rather than an
// actual record — those records are NOT relabelled into something that
// *looks* like live evidence; they are kept out of current inventory, period.
//
// Callers MUST treat a null return as "exclude this record from current
// inventory." Snapshot records remain available to the build pipeline via
// data/listings.snapshot.json; they are not served by the running API.
function seedProvenance(listing) {
  if (!listing || typeof listing !== 'object') return null;
  const provenance = listing.provenance && typeof listing.provenance === 'object' ? listing.provenance : {};
  if (provenance.origin !== 'live' || provenance.recordKind !== 'source_record') return null;
  if (!validateListingForIngestion(listing).isValid) return null;
  return { ...provenance };
}

module.exports = { seedProvenance };
