-- Reverse order of 0003_cross_runtime_assignment_and_attempt.sql,
-- respecting foreign key dependency order.
DROP INDEX IF EXISTS idempotency_record_pending_stale_idx;
DROP INDEX IF EXISTS idempotency_record_expires_idx;
DROP TABLE IF EXISTS idempotency_record;

DROP TRIGGER IF EXISTS semantic_action_log_no_delete ON semantic_action_log;
DROP TRIGGER IF EXISTS semantic_action_log_no_update ON semantic_action_log;
DROP FUNCTION IF EXISTS reject_semantic_action_log_mutation();
DROP TABLE IF EXISTS semantic_action_log;

DROP TABLE IF EXISTS attempt_response;

DROP INDEX IF EXISTS learning_attempt_creation_idempotency_uq;
DROP TABLE IF EXISTS learning_attempt;

DROP TABLE IF EXISTS assignment_runtime_channel;
DROP TABLE IF EXISTS assignment;

DROP TRIGGER IF EXISTS content_bundle_immutability ON content_bundle;
DROP FUNCTION IF EXISTS reject_content_bundle_published_mutation();
DROP TABLE IF EXISTS content_bundle_runtime_channel;
DROP TABLE IF EXISTS content_bundle;
