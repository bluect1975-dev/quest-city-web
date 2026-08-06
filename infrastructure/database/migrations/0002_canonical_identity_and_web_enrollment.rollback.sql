-- Reverse order of 0002_canonical_identity_and_web_enrollment.sql,
-- respecting foreign key dependency order.
DROP TABLE IF EXISTS audit_event;
DROP TABLE IF EXISTS rate_limit_bucket;
DROP TABLE IF EXISTS student_session;
DROP TABLE IF EXISTS school_enrollment;
DROP INDEX IF EXISTS class_access_code_hash_active_uq;
DROP TABLE IF EXISTS class_access_code;
DROP TABLE IF EXISTS student_profile;
DROP TABLE IF EXISTS school_class;
DROP TABLE IF EXISTS tenant;
