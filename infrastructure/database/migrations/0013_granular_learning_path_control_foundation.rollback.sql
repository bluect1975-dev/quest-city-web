-- Reverse of 0013_granular_learning_path_control_foundation.sql, in exact
-- opposite order. Requires no pre-existing LEARNING_PATH_ADJUSTMENT
-- facilitation_proposal row and no row in any of the three new tables to
-- remain (none could exist before this migration's own forward run) -- the
-- restored, narrower constraints will fail loudly if any exist, which is
-- the correct, safe behavior rather than silently discarding data.

BEGIN;

-- D. facilitation_proposal: restore to its exact pre-0013 (0012) shape.
ALTER TABLE facilitation_proposal DROP CONSTRAINT IF EXISTS facilitation_proposal_target_alternative_ck;
ALTER TABLE facilitation_proposal DROP CONSTRAINT IF EXISTS facilitation_proposal_target_learning_path_ck;
ALTER TABLE facilitation_proposal DROP COLUMN IF EXISTS target_requested_alternative_content_ref;
ALTER TABLE facilitation_proposal DROP COLUMN IF EXISTS target_requested_state;
ALTER TABLE facilitation_proposal DROP COLUMN IF EXISTS target_resource_ref;
ALTER TABLE facilitation_proposal DROP COLUMN IF EXISTS target_resource_type;

ALTER TABLE facilitation_proposal DROP CONSTRAINT IF EXISTS facilitation_proposal_proposal_type_check;
ALTER TABLE facilitation_proposal ADD CONSTRAINT facilitation_proposal_proposal_type_check
  CHECK (proposal_type IN ('FACILITATION', 'DIFFICULTY'));

-- C, B, A: drop the three new tables, in reverse dependency order.
DROP TABLE IF EXISTS learning_path_snapshot;
DROP TABLE IF EXISTS learning_path_alternative;
DROP TABLE IF EXISTS learning_path_policy;

COMMIT;
