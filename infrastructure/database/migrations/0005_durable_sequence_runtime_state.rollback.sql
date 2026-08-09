-- Rollback for 0005_durable_sequence_runtime_state.sql.
DROP INDEX IF EXISTS sequence_runtime_state_tenant_student_idx;
DROP TABLE IF EXISTS sequence_runtime_state;
