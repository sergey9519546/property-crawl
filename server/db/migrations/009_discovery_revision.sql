CREATE TABLE IF NOT EXISTS discovery_listing_revision (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  revision BIGINT NOT NULL DEFAULT 1
);

INSERT INTO discovery_listing_revision(singleton, revision)
VALUES (TRUE, 1)
ON CONFLICT (singleton) DO NOTHING;

CREATE OR REPLACE FUNCTION bump_discovery_listing_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE discovery_listing_revision SET revision = revision + 1 WHERE singleton = TRUE;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS listings_discovery_revision ON listings;
CREATE TRIGGER listings_discovery_revision
AFTER INSERT OR UPDATE OR DELETE ON listings
FOR EACH STATEMENT EXECUTE FUNCTION bump_discovery_listing_revision();
