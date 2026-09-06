const { validateListingForIngestion } = require('../scrapers/validation');

// Persisted observations keep their original observation time, never the boot
// time. Legacy snapshots without an evidence trail remain demonstration data.
function seedProvenance(listing) {
  const provenance = listing.provenance && typeof listing.provenance === 'object' ? listing.provenance : {};
  if (provenance.origin === 'live' && provenance.recordKind === 'source_record'
      && validateListingForIngestion(listing).isValid) return { ...provenance };
  return { ...provenance, origin: 'snapshot', observed: false, recordKind: 'demo', publisher: 'Embedded data snapshot' };
}

module.exports = { seedProvenance };
