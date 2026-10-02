-- Preserve collection history while withdrawing legacy approvals that cannot be
-- backed by two complete observations of the exact configured publisher scope.
UPDATE discovery_source_rollouts rollout
SET state = 'canary', promoted_at = NULL, updated_at = NOW()
WHERE state = 'promoted' AND (
  clean_canary_runs < 2 OR configured_scope = '{}'::jsonb OR
  (SELECT count(*) FROM discovery_source_runs run
    WHERE run.source_key = rollout.source_key AND run.status = 'complete'
      AND run.accepted_count > 0 AND run.rejected_count = 0
      AND run.coverage->'complete' = 'true'::jsonb
      AND run.coverage->'fullSweepComplete' = 'true'::jsonb
      AND run.coverage->'truncated' = 'false'::jsonb
      AND run.coverage->'acquisitionScope' = rollout.configured_scope) < 2
);
