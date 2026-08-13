import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  ReviewService,
  FeedbackService,
  RecoveryAssignmentService,
  type StaffInternalIdentity,
} from "@quest-city-web/staff-identity";

/**
 * WEB-M3B integration tests against a real, dockerized PostgreSQL instance
 * with migrations 0001-0004 applied — review queue lifecycle, teacher
 * feedback create/publish/revoke, and recovery assignment creation.
 *
 *   DATABASE_URL=postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web \
 *     pnpm --filter @quest-city-web/tests-integration run test -- staff-review-feedback-flow
 */
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web";

const pool = new Pool({ connectionString: DATABASE_URL });

interface Fixture {
  tenantId: string;
  otherTenantId: string;
  classId: string;
  otherClassId: string;
  studentProfileId: string;
  enrollmentId: string;
  contentBundleId: string;
  assignmentId: string;
  attemptId: string;
  staffAccountId: string;
  membershipId: string;
}

async function truncateAll(): Promise<void> {
  await pool.query(
    "TRUNCATE teacher_feedback, review_queue_item, staff_class_assignment, staff_session, staff_tenant_membership, staff_account, idempotency_record, semantic_action_log, attempt_response, learning_attempt, assignment_runtime_channel, assignment, content_bundle_runtime_channel, content_bundle, school_enrollment, class_access_code, school_class, student_profile, student_session, rate_limit_bucket, audit_event, tenant CASCADE",
  );
}

function rnd(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function insertAttempt(
  tenantId: string,
  assignmentId: string,
  studentProfileId: string,
  enrollmentId: string,
  contentBundleId: string,
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO learning_attempt
       (tenant_id, event_id, assignment_id, student_profile_id, enrollment_id, content_bundle_id, content_id, content_version,
        runtime_channel, attempt_state, completion_status, completed_at, outcome, creation_idempotency_key)
     VALUES ($1, $2, $3, $4, $5, $6, gen_random_uuid(), '1.0.0', 'WEB', 'COMPLETED', 'CONSOLIDATED', now(), '{}'::jsonb, $7) RETURNING id`,
    [tenantId, `evt_${rnd()}`, assignmentId, studentProfileId, enrollmentId, contentBundleId, `key_${rnd()}`],
  );
  return result.rows[0]!.id;
}

async function buildFixture(role: "TEACHER" | "SCHOOL_ADMIN" = "SCHOOL_ADMIN"): Promise<Fixture> {
  const tenantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO tenant (public_id, type, status, name) VALUES ($1, 'SCHOOL', 'ACTIVE', 'Test School') RETURNING id`,
      [`sch_${rnd()}`],
    )
  ).rows[0]!.id;
  const otherTenantId = (
    await pool.query<{ id: string }>(
      `INSERT INTO tenant (public_id, type, status, name) VALUES ($1, 'SCHOOL', 'ACTIVE', 'Other School') RETURNING id`,
      [`sch_${rnd()}`],
    )
  ).rows[0]!.id;

  const classId = (
    await pool.query<{ id: string }>(
      `INSERT INTO school_class (tenant_id, public_id, name, status) VALUES ($1, $2, 'Test Class', 'ACTIVE') RETURNING id`,
      [tenantId, `cls_${rnd()}`],
    )
  ).rows[0]!.id;
  const otherClassId = (
    await pool.query<{ id: string }>(
      `INSERT INTO school_class (tenant_id, public_id, name, status) VALUES ($1, $2, 'Other Class', 'ACTIVE') RETURNING id`,
      [tenantId, `cls_${rnd()}`],
    )
  ).rows[0]!.id;

  const studentProfileId = (
    await pool.query<{ id: string }>(
      `INSERT INTO student_profile (tenant_id, student_public_id, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`,
      [tenantId, `std_${rnd()}`],
    )
  ).rows[0]!.id;

  const contentBundleId = (
    await pool.query<{ id: string }>(
      `INSERT INTO content_bundle (public_id, subject_id, bundle_version, bundle_type, status, manifest_hash, storage_ref)
       VALUES ($1, 'MAT', '1.0.0', 'RUNTIME_FIXTURE_BUNDLE', 'PUBLISHED', 'sha256:abc', 's3://x') RETURNING id`,
      [`bnd_${rnd()}`],
    )
  ).rows[0]!.id;
  await pool.query(`INSERT INTO content_bundle_runtime_channel (content_bundle_id, runtime_channel) VALUES ($1, 'WEB')`, [
    contentBundleId,
  ]);

  const assignmentId = (
    await pool.query<{ id: string }>(
      `INSERT INTO assignment (tenant_id, class_id, public_id, title, status, created_by_actor_type, created_by_actor_id, completion_policy, content_bundle_id)
       VALUES ($1, $2, $3, 'Test assignment', 'PUBLISHED', 'ADMIN_SEED_SCRIPT', 'test-fixture', 'FIRST_VALID_COMPLETION', $4) RETURNING id`,
      [tenantId, classId, `asn_${rnd()}`, contentBundleId],
    )
  ).rows[0]!.id;
  await pool.query(`INSERT INTO assignment_runtime_channel (assignment_id, tenant_id, runtime_channel) VALUES ($1, $2, 'WEB')`, [
    assignmentId,
    tenantId,
  ]);

  const enrollmentId = (
    await pool.query<{ id: string }>(
      `INSERT INTO school_enrollment (tenant_id, class_id, student_profile_id, access_alias, access_alias_normalized, pin_hash, status)
       VALUES ($1, $2, $3, 'Test', 'test', 'x', 'ACTIVE') RETURNING id`,
      [tenantId, classId, studentProfileId],
    )
  ).rows[0]!.id;

  const attemptId = await insertAttempt(tenantId, assignmentId, studentProfileId, enrollmentId, contentBundleId);

  const staffAccountId = (
    await pool.query<{ id: string }>(
      `INSERT INTO staff_account (email, password_hash, password_algorithm, status, created_by_actor_type, created_by_actor_id)
       VALUES ($1, 'x', 'scrypt', 'ACTIVE', 'ADMIN_SEED_SCRIPT', 'test-fixture') RETURNING id`,
      [`staff-${rnd()}@example.org`],
    )
  ).rows[0]!.id;
  const membershipId = (
    await pool.query<{ id: string }>(
      `INSERT INTO staff_tenant_membership (staff_account_id, tenant_id, role, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
      [staffAccountId, tenantId, role],
    )
  ).rows[0]!.id;
  if (role === "TEACHER") {
    await pool.query(
      `INSERT INTO staff_class_assignment (staff_tenant_membership_id, tenant_id, class_id) VALUES ($1, $2, $3)`,
      [membershipId, tenantId, classId],
    );
  }

  return {
    tenantId,
    otherTenantId,
    classId,
    otherClassId,
    studentProfileId,
    enrollmentId,
    contentBundleId,
    assignmentId,
    attemptId,
    staffAccountId,
    membershipId,
  };
}

function identityFor(fixture: Fixture, role: "TEACHER" | "SCHOOL_ADMIN"): StaffInternalIdentity {
  return {
    staffAccountId: fixture.staffAccountId,
    tenantId: fixture.tenantId,
    staffTenantMembershipId: fixture.membershipId,
    role,
    classScope: role === "TEACHER" ? [fixture.classId] : null,
    csrfTokenHash: "unused-in-these-tests",
    sessionId: "session-unused-in-these-tests",
  };
}

async function insertReviewItem(
  fixture: Fixture,
  overrides: Partial<{ classId: string; attemptId: string }> = {},
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO review_queue_item (tenant_id, class_id, student_profile_id, learning_attempt_id, reason, priority)
     VALUES ($1, $2, $3, $4, 'INCORRECT_ATTEMPT', 'MEDIUM') RETURNING id`,
    [fixture.tenantId, overrides.classId ?? fixture.classId, fixture.studentProfileId, overrides.attemptId ?? fixture.attemptId],
  );
  return result.rows[0]!.id;
}

// A single shared `pool` across all three describe blocks below — closed
// exactly once here, not per-describe (each describe's own afterAll
// calling pool.end() would close it before the next describe's tests run).
afterAll(async () => {
  await truncateAll();
  await pool.end();
});

describe("ReviewService (02_35 §7)", () => {
  beforeEach(truncateAll);

  it("list() scopes a TEACHER to its assigned classes only, and a SCHOOL_ADMIN to the whole tenant", async () => {
    const fixture = await buildFixture("TEACHER");
    const inScope = await insertReviewItem(fixture);
    // A distinct attempt is required: the partial unique index
    // review_queue_item_attempt_active_uq allows at most one active
    // (OPEN/IN_REVIEW) item per learning_attempt_id, tenant-wide.
    const otherAttemptId = await insertAttempt(
      fixture.tenantId,
      fixture.assignmentId,
      fixture.studentProfileId,
      fixture.enrollmentId,
      fixture.contentBundleId,
    );
    const outOfScope = await insertReviewItem(fixture, { classId: fixture.otherClassId, attemptId: otherAttemptId });
    const service = new ReviewService(pool);

    const teacherResults = await service.list(identityFor(fixture, "TEACHER"), {});
    expect(teacherResults.map((r) => r.id)).toEqual([inScope]);

    const adminResults = await service.list(identityFor(fixture, "SCHOOL_ADMIN"), {});
    expect(adminResults.map((r) => r.id).sort()).toEqual([inScope, outOfScope].sort());
  });

  it("transitions OPEN -> IN_REVIEW -> RESOLVED, attributing and clearing the reviewer correctly", async () => {
    const fixture = await buildFixture();
    const itemId = await insertReviewItem(fixture);
    const service = new ReviewService(pool);
    const identity = identityFor(fixture, "SCHOOL_ADMIN");

    const claimed = await service.transitionStatus({
      identity,
      reviewItemId: itemId,
      targetStatus: "IN_REVIEW",
      ifMatchVersion: 1,
      idempotencyKey: `key-${rnd()}`,
    });
    expect(claimed.status).toBe("IN_REVIEW");
    expect(claimed.reviewerStaffAccountId).toBe(fixture.staffAccountId);
    expect(claimed.version).toBe(2);

    const resolved = await service.transitionStatus({
      identity,
      reviewItemId: itemId,
      targetStatus: "RESOLVED",
      ifMatchVersion: 2,
      idempotencyKey: `key-${rnd()}`,
    });
    expect(resolved.status).toBe("RESOLVED");
    expect(resolved.reviewerStaffAccountId).toBe(fixture.staffAccountId);

    const reopened = await service.transitionStatus({
      identity,
      reviewItemId: itemId,
      targetStatus: "OPEN",
      ifMatchVersion: 3,
      idempotencyKey: `key-${rnd()}`,
    });
    expect(reopened.status).toBe("OPEN");
    expect(reopened.reviewerStaffAccountId).toBeNull();
  });

  it("rejects a transition not in the allowed set (e.g. RESOLVED -> DISMISSED) with VALIDATION_ERROR", async () => {
    const fixture = await buildFixture();
    const itemId = await insertReviewItem(fixture);
    const service = new ReviewService(pool);
    const identity = identityFor(fixture, "SCHOOL_ADMIN");
    await service.transitionStatus({
      identity,
      reviewItemId: itemId,
      targetStatus: "RESOLVED",
      ifMatchVersion: 1,
      idempotencyKey: `key-${rnd()}`,
    });

    await expect(
      service.transitionStatus({
        identity,
        reviewItemId: itemId,
        targetStatus: "DISMISSED",
        ifMatchVersion: 2,
        idempotencyKey: `key-${rnd()}`,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rejects a stale If-Match version with ETAG_MISMATCH", async () => {
    const fixture = await buildFixture();
    const itemId = await insertReviewItem(fixture);
    const service = new ReviewService(pool);
    const identity = identityFor(fixture, "SCHOOL_ADMIN");

    await expect(
      service.transitionStatus({
        identity,
        reviewItemId: itemId,
        targetStatus: "IN_REVIEW",
        ifMatchVersion: 999,
        idempotencyKey: `key-${rnd()}`,
      }),
    ).rejects.toMatchObject({ code: "ETAG_MISMATCH" });
  });

  it("a TEACHER out of scope gets REVIEW_ITEM_NOT_FOUND (uniform anti-enumeration), not CLASS_ACCESS_DENIED", async () => {
    const fixture = await buildFixture("TEACHER");
    const itemId = await insertReviewItem(fixture, { classId: fixture.otherClassId });
    const service = new ReviewService(pool);

    await expect(
      service.transitionStatus({
        identity: identityFor(fixture, "TEACHER"),
        reviewItemId: itemId,
        targetStatus: "IN_REVIEW",
        ifMatchVersion: 1,
        idempotencyKey: `key-${rnd()}`,
      }),
    ).rejects.toMatchObject({ code: "REVIEW_ITEM_NOT_FOUND" });
  });

  it("replays the exact same result for a repeated (Idempotency-Key, payload) pair without a second transition", async () => {
    const fixture = await buildFixture();
    const itemId = await insertReviewItem(fixture);
    const service = new ReviewService(pool);
    const identity = identityFor(fixture, "SCHOOL_ADMIN");
    const key = `key-${rnd()}`;

    const first = await service.transitionStatus({
      identity,
      reviewItemId: itemId,
      targetStatus: "IN_REVIEW",
      ifMatchVersion: 1,
      idempotencyKey: key,
    });
    const second = await service.transitionStatus({
      identity,
      reviewItemId: itemId,
      targetStatus: "IN_REVIEW",
      ifMatchVersion: 1,
      idempotencyKey: key,
    });
    // The replayed response round-tripped through the idempotency_record's
    // JSON column, so its date fields are ISO strings, not Date instances
    // (see apps/api/lib/teacher-feedback-dto.ts's identical rationale) —
    // compare via JSON so both sides normalize the same way.
    expect(JSON.parse(JSON.stringify(second))).toEqual(JSON.parse(JSON.stringify(first)));

    const row = await pool.query<{ version: number }>(`SELECT version FROM review_queue_item WHERE id = $1`, [itemId]);
    expect(row.rows[0]!.version).toBe(2);
  });
});

describe("FeedbackService (02_35 §9)", () => {
  beforeEach(truncateAll);

  it("creates a DRAFT feedback, publishes it (implicitly resolving the linked review item), then revokes it without resetting deliveryStatus", async () => {
    const fixture = await buildFixture();
    const reviewItemId = await insertReviewItem(fixture);
    const service = new FeedbackService(pool);
    const identity = identityFor(fixture, "SCHOOL_ADMIN");

    const created = await service.create({
      identity,
      attemptId: fixture.attemptId,
      structuredFeedback: { verdict: "needs review" },
      freeText: "Ottimo lavoro",
      originReviewQueueItemId: reviewItemId,
      idempotencyKey: `key-${rnd()}`,
    });
    expect(created.publicationStatus).toBe("DRAFT");
    expect(created.deliveryStatus).toBe("NOT_APPLICABLE");

    const published = await service.publish({
      identity,
      feedbackId: created.id,
      ifMatchVersion: created.version,
      idempotencyKey: `key-${rnd()}`,
    });
    expect(published.publicationStatus).toBe("PUBLISHED");
    expect(published.deliveryStatus).toBe("PENDING");
    expect(published.publishedAt).not.toBeNull();

    const reviewRow = await pool.query<{ status: string }>(`SELECT status FROM review_queue_item WHERE id = $1`, [reviewItemId]);
    expect(reviewRow.rows[0]!.status).toBe("RESOLVED");

    // Simulate the runtime having delivered and the student having read it before revocation.
    await pool.query(`UPDATE teacher_feedback SET delivery_status = 'READ' WHERE id = $1`, [created.id]);

    const revoked = await service.revoke({
      identity,
      feedbackId: created.id,
      ifMatchVersion: published.version,
      idempotencyKey: `key-${rnd()}`,
    });
    expect(revoked.publicationStatus).toBe("REVOKED");
    expect(revoked.deliveryStatus).toBe("READ");
    expect(revoked.revokedAt).not.toBeNull();
  });

  it("rejects publishing a feedback that is not DRAFT with FEEDBACK_NOT_PUBLISHABLE", async () => {
    const fixture = await buildFixture();
    const service = new FeedbackService(pool);
    const identity = identityFor(fixture, "SCHOOL_ADMIN");
    const created = await service.create({
      identity,
      attemptId: fixture.attemptId,
      structuredFeedback: {},
      freeText: null,
      originReviewQueueItemId: null,
      idempotencyKey: `key-${rnd()}`,
    });
    const published = await service.publish({
      identity,
      feedbackId: created.id,
      ifMatchVersion: created.version,
      idempotencyKey: `key-${rnd()}`,
    });

    await expect(
      service.publish({ identity, feedbackId: created.id, ifMatchVersion: published.version, idempotencyKey: `key-${rnd()}` }),
    ).rejects.toMatchObject({ code: "FEEDBACK_NOT_PUBLISHABLE" });
  });

  it("rejects revoking a feedback that is not PUBLISHED with FEEDBACK_ALREADY_REVOKED", async () => {
    const fixture = await buildFixture();
    const service = new FeedbackService(pool);
    const identity = identityFor(fixture, "SCHOOL_ADMIN");
    const created = await service.create({
      identity,
      attemptId: fixture.attemptId,
      structuredFeedback: {},
      freeText: null,
      originReviewQueueItemId: null,
      idempotencyKey: `key-${rnd()}`,
    });

    await expect(
      service.revoke({ identity, feedbackId: created.id, ifMatchVersion: created.version, idempotencyKey: `key-${rnd()}` }),
    ).rejects.toMatchObject({ code: "FEEDBACK_ALREADY_REVOKED" });
  });

  it("a TEACHER out of scope for the attempt's class gets CLASS_ACCESS_DENIED on create()", async () => {
    const fixture = await buildFixture("TEACHER");
    // Move the attempt's assignment to a class the TEACHER is NOT assigned to.
    await pool.query(`UPDATE assignment SET class_id = $1 WHERE id = $2`, [fixture.otherClassId, fixture.assignmentId]);
    const service = new FeedbackService(pool);

    await expect(
      service.create({
        identity: identityFor(fixture, "TEACHER"),
        attemptId: fixture.attemptId,
        structuredFeedback: {},
        freeText: null,
        originReviewQueueItemId: null,
        idempotencyKey: `key-${rnd()}`,
      }),
    ).rejects.toMatchObject({ code: "CLASS_ACCESS_DENIED" });
  });

  it("replays the exact same feedback for a repeated (Idempotency-Key, payload) create() without a second row", async () => {
    const fixture = await buildFixture();
    const service = new FeedbackService(pool);
    const identity = identityFor(fixture, "SCHOOL_ADMIN");
    const key = `key-${rnd()}`;
    const input = {
      identity,
      attemptId: fixture.attemptId,
      structuredFeedback: { verdict: "ok" },
      freeText: null,
      originReviewQueueItemId: null,
      idempotencyKey: key,
    };

    const first = await service.create(input);
    const second = await service.create(input);
    expect(second.id).toBe(first.id);

    const count = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM teacher_feedback WHERE learning_attempt_id = $1`, [
      fixture.attemptId,
    ]);
    expect(count.rows[0]!.n).toBe("1");
  });
});

describe("RecoveryAssignmentService (02_35 §11)", () => {
  beforeEach(truncateAll);

  it("rejects creation from a feedback that is not PUBLISHED with RECOVERY_ASSIGNMENT_SOURCE_NOT_PUBLISHED", async () => {
    const fixture = await buildFixture();
    const feedbackService = new FeedbackService(pool);
    const recoveryService = new RecoveryAssignmentService(pool);
    const identity = identityFor(fixture, "SCHOOL_ADMIN");
    const draft = await feedbackService.create({
      identity,
      attemptId: fixture.attemptId,
      structuredFeedback: {},
      freeText: null,
      originReviewQueueItemId: null,
      idempotencyKey: `key-${rnd()}`,
    });

    await expect(
      recoveryService.create({
        identity,
        attemptId: fixture.attemptId,
        originTeacherFeedbackId: draft.id,
        contentBundleId: fixture.contentBundleId,
        allowedRuntimeChannels: ["WEB"],
        idempotencyKey: `key-${rnd()}`,
      }),
    ).rejects.toMatchObject({ code: "RECOVERY_ASSIGNMENT_SOURCE_NOT_PUBLISHED" });
  });

  it("creates a recovery assignment from a PUBLISHED feedback — additive columns only, no second assignment table", async () => {
    const fixture = await buildFixture();
    const feedbackService = new FeedbackService(pool);
    const recoveryService = new RecoveryAssignmentService(pool);
    const identity = identityFor(fixture, "SCHOOL_ADMIN");
    const draft = await feedbackService.create({
      identity,
      attemptId: fixture.attemptId,
      structuredFeedback: {},
      freeText: null,
      originReviewQueueItemId: null,
      idempotencyKey: `key-${rnd()}`,
    });
    const published = await feedbackService.publish({
      identity,
      feedbackId: draft.id,
      ifMatchVersion: draft.version,
      idempotencyKey: `key-${rnd()}`,
    });

    const result = await recoveryService.create({
      identity,
      attemptId: fixture.attemptId,
      originTeacherFeedbackId: published.id,
      contentBundleId: fixture.contentBundleId,
      allowedRuntimeChannels: ["WEB"],
      idempotencyKey: `key-${rnd()}`,
    });
    expect(result.studentProfileId).toBe(fixture.studentProfileId);
    expect(result.status).toBe("PUBLISHED");

    const row = await pool.query<{ origin_type: string; target_student_profile_id: string; class_id: string }>(
      `SELECT origin_type, target_student_profile_id, class_id FROM assignment WHERE id = $1`,
      [result.assignmentId],
    );
    expect(row.rows[0]!.origin_type).toBe("RECOVERY_FROM_REVIEW");
    expect(row.rows[0]!.target_student_profile_id).toBe(fixture.studentProfileId);
    expect(row.rows[0]!.class_id).toBe(fixture.classId);

    const feedbackRow = await pool.query<{ recovery_assignment_id: string }>(
      `SELECT recovery_assignment_id FROM teacher_feedback WHERE id = $1`,
      [published.id],
    );
    expect(feedbackRow.rows[0]!.recovery_assignment_id).toBe(result.assignmentId);

    // No second assignment-like table exists — this row lives in the same `assignment` table as every WEB-M2B ADMIN_SEED row.
    const adminSeedCount = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM assignment WHERE tenant_id = $1 AND origin_type = 'ADMIN_SEED'`,
      [fixture.tenantId],
    );
    expect(adminSeedCount.rows[0]!.n).toBe("1"); // the original assignment from buildFixture()
  });
});
