# Migrations

Forward-only SQL, applied by `scripts/discovery-migrate.js` (also run on boot
when `AUTO_MIGRATE=1`). Each file runs once, inside its own transaction,
wrapped with its ledger row. Fresh databases get `schema.sql` first, then this
entire chain — so both descriptions must agree.

## Rules

1. **Never edit an applied migration.** The ledger records each file's sha256;
   a changed file no longer aborts the run (that wedged production for three
   migrations once — see the comment in `scripts/discovery-migrate.js`), but the
   edited SQL is *not* re-executed: the change simply never reaches databases
   that already applied the file. Always express a change as a new migration.
2. **Forward-only.** There are no down migrations. Rollback is a redeploy of
   the previous commit; the schema grows additively.
3. **Mirror every file.** Copy `server/db/migrations/<name>.sql` to
   `src/lib/db/migrations/<name>.sql` byte-identical
   (`test/db/migration-mirror.test.js` enforces this), and update
   `server/db/schema.sql` **and** its mirror `src/lib/db/schema.sql` so a fresh
   database matches the end state.
4. **Every statement must tolerate the transaction wrapper.** The runner wraps
   each file in `BEGIN`/`COMMIT`. `CREATE INDEX CONCURRENTLY`,
   `REFRESH MATERIALIZED VIEW CONCURRENTLY`, and `COMMIT` inside the file are
   therefore forbidden (003/004 carry the history of the nested-COMMIT bug).
5. **Every statement should be safe against the current schema.** A fresh
   database runs `schema.sql` (already in the end state) and then this chain on
   top — use `IF NOT EXISTS` / `DROP ... IF EXISTS` / `ON CONFLICT` everywhere.
6. **Publisher identifiers are unbounded.** Do not reintroduce fixed-width
   `VARCHAR` for ids, record ids, party names, or URLs — migrations 017, 022,
   and 030 each fixed one of these after a live ingestion failure.
7. **Verify with the fresh-boot guard.** After changing `schema.sql` or adding
   a migration, run `npm run test:db`; `test/db/fresh-boot-schema.test.js`
   boots a throwaway embedded PostgreSQL, applies everything, and compares the
   result to `test/db/golden-schema.json`. Regenerate deliberately
   (`UPDATE_GOLDEN=1 node --test test/db/fresh-boot-schema.test.js`) and review
   the golden diff as part of the same change.
