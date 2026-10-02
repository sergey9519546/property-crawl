-- Absence of an explicit document inventory is unknown, not an observed empty inventory.
ALTER TABLE listings ALTER COLUMN has_documents DROP NOT NULL;
ALTER TABLE listings ALTER COLUMN has_documents DROP DEFAULT;
UPDATE listings SET has_documents = CASE
  WHEN jsonb_typeof(provenance #> '{sourceFacts,documents}') = 'array'
    THEN jsonb_array_length(provenance #> '{sourceFacts,documents}') > 0
  WHEN has_documents = TRUE THEN TRUE ELSE NULL END;

CREATE TABLE IF NOT EXISTS discovery_public_record_research (
  listing_id text NOT NULL,
  evidence_hash char(64) NOT NULL,
  result jsonb NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(listing_id, evidence_hash)
);

-- Publisher identities remain independent. Only an exact jurisdiction and parcel
-- identifier can group records; address-only similarities are separate candidates.
CREATE OR REPLACE FUNCTION discovery_parcel_identity(p jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT upper(nullif(trim(coalesce(p->>'parcelNumber', p->>'parcelId', p->>'apn',
    p#>>'{sourceFacts,parcelNumber}',p#>>'{sourceFacts,parcelId}',p#>>'{sourceFacts,apn}')),''));
$$;
CREATE OR REPLACE FUNCTION discovery_parcel_jurisdiction(p jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT upper(nullif(trim(coalesce(p->>'jurisdictionFips',p#>>'{sourceFacts,jurisdictionFips}',
    p->>'jurisdiction',p#>>'{sourceFacts,jurisdiction}')),''));
$$;
CREATE INDEX IF NOT EXISTS discovery_parcel_lookup ON listings
  (discovery_parcel_jurisdiction(provenance), discovery_parcel_identity(provenance))
  WHERE discovery_parcel_jurisdiction(provenance) IS NOT NULL
    AND discovery_parcel_identity(provenance) IS NOT NULL;
