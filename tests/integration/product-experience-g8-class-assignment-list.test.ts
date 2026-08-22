import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { AssignmentRepository } from "@quest-city-web/attempts";

/**
 * Pilot Product Experience Remediation, Tranche G8 (`UX-CLASS-ASSIGNMENT-LIST-01`)
 * — `GET /classes/{classId}/assignments`'s underlying query
 * (`AssignmentRepository.findByClassIdForStaff`), the persistent list a
 * teacher now sees of what they've assigned. Deliberately broader than
 * `findByClassIdForStudentDiscovery` (tested separately in
 * `tranche-b-student-access-security.test.ts`) — every status and origin,
 * not only `STAFF_GENERAL`+`PUBLISHED`.
 *
 *   DATABASE_URL=postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web \
 *     pnpm --filter @quest-city-web/tests-integration run test -- product-experience-g8-class-assignment-list
 */
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web";

const pool = new Pool({ connectionString: DATABASE_URL });

function rnd(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function truncateAll(): Promise<void> {
  await pool.query(
    "TRUNCATE assignment_runtime_channel, assignment, content_bundle_runtime_channel, content_bundle, student_profile, school_class, tenant CASCADE",
  );
}

async function createTenant(): Promise<string> {
  return (
    await pool.query<{ id: string }>(
      `INSERT INTO tenant (public_id, type, status, name) VALUES ($1, 'SCHOOL', 'ACTIVE', 'Test School') RETURNING id`,
      [`sch_${rnd()}`],
    )
  ).rows[0]!.id;
}

async function createClass(tenantId: string): Promise<string> {
  return (
    await pool.query<{ id: string }>(
      `INSERT INTO school_class (tenant_id, public_id, name, status) VALUES ($1, $2, 'Test Class', 'ACTIVE') RETURNING id`,
      [tenantId, `cls_${rnd()}`],
    )
  ).rows[0]!.id;
}

async function createContentBundle(): Promise<string> {
  const id = (
    await pool.query<{ id: string }>(
      `INSERT INTO content_bundle (public_id, subject_id, bundle_version, bundle_type, status, manifest_hash, storage_ref)
       VALUES ($1, 'MAT', '1.0.0', 'RUNTIME_FIXTURE_BUNDLE', 'PUBLISHED', $2, 's3://x') RETURNING id`,
      [`bnd_${rnd()}`, `sha256:${rnd()}`],
    )
  ).rows[0]!.id;
  await pool.query(`INSERT INTO content_bundle_runtime_channel (content_bundle_id, runtime_channel) VALUES ($1, 'WEB')`, [id]);
  return id;
}

async function createAssignment(input: {
  tenantId: string;
  classId: string;
  contentBundleId: string;
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
  originType: "ADMIN_SEED" | "RECOVERY_FROM_REVIEW" | "STAFF_GENERAL";
}): Promise<string> {
  const targetStudentProfileId =
    input.originType === "RECOVERY_FROM_REVIEW"
      ? (
          await pool.query<{ id: string }>(
            `INSERT INTO student_profile (tenant_id, student_public_id, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`,
            [input.tenantId, `stu_${rnd()}`],
          )
        ).rows[0]!.id
      : null;
  const assignmentId = (
    await pool.query<{ id: string }>(
      `INSERT INTO assignment
         (tenant_id, class_id, public_id, title, status, created_by_actor_type, created_by_actor_id, completion_policy, content_bundle_id, origin_type, target_student_profile_id)
       VALUES ($1, $2, $3, 'Test Assignment', $4, 'STAFF', 'test-fixture', 'FIRST_VALID_COMPLETION', $5, $6, $7)
       RETURNING id`,
      [input.tenantId, input.classId, `asn_${rnd()}`, input.status, input.contentBundleId, input.originType, targetStudentProfileId],
    )
  ).rows[0]!.id;
  await pool.query(`INSERT INTO assignment_runtime_channel (assignment_id, tenant_id, runtime_channel) VALUES ($1, $2, 'WEB')`, [
    assignmentId,
    input.tenantId,
  ]);
  return assignmentId;
}

afterAll(async () => {
  await truncateAll();
  await pool.end();
});

describe("AssignmentRepository.findByClassIdForStaff (GET /classes/{classId}/assignments)", () => {
  beforeEach(truncateAll);

  it("returns every status and origin, unlike the student-discovery filter", async () => {
    const tenantId = await createTenant();
    const classId = await createClass(tenantId);
    const contentBundleId = await createContentBundle();
    const staffGeneral = await createAssignment({ tenantId, classId, contentBundleId, status: "PUBLISHED", originType: "STAFF_GENERAL" });
    const draft = await createAssignment({ tenantId, classId, contentBundleId, status: "DRAFT", originType: "STAFF_GENERAL" });
    const adminSeed = await createAssignment({ tenantId, classId, contentBundleId, status: "PUBLISHED", originType: "ADMIN_SEED" });
    const archived = await createAssignment({ tenantId, classId, contentBundleId, status: "ARCHIVED", originType: "STAFF_GENERAL" });

    const repo = new AssignmentRepository(pool);
    const results = await repo.findByClassIdForStaff(classId, tenantId);
    expect(new Set(results.map((r) => r.id))).toEqual(new Set([staffGeneral, draft, adminSeed, archived]));
  });

  it("excludes assignments belonging to a different class in the same tenant", async () => {
    const tenantId = await createTenant();
    const classId = await createClass(tenantId);
    const otherClassId = await createClass(tenantId);
    const contentBundleId = await createContentBundle();
    await createAssignment({ tenantId, classId: otherClassId, contentBundleId, status: "PUBLISHED", originType: "STAFF_GENERAL" });

    const repo = new AssignmentRepository(pool);
    const results = await repo.findByClassIdForStaff(classId, tenantId);
    expect(results).toHaveLength(0);
  });

  it("excludes assignments belonging to another tenant even if the classId string were guessed", async () => {
    const tenantId = await createTenant();
    const otherTenantId = await createTenant();
    const otherTenantClassId = await createClass(otherTenantId);
    const contentBundleId = await createContentBundle();
    await createAssignment({ tenantId: otherTenantId, classId: otherTenantClassId, contentBundleId, status: "PUBLISHED", originType: "STAFF_GENERAL" });

    const repo = new AssignmentRepository(pool);
    const results = await repo.findByClassIdForStaff(otherTenantClassId, tenantId);
    expect(results).toHaveLength(0);
  });

  it("orders newest-first (created_at DESC)", async () => {
    const tenantId = await createTenant();
    const classId = await createClass(tenantId);
    const contentBundleId = await createContentBundle();
    const first = await createAssignment({ tenantId, classId, contentBundleId, status: "PUBLISHED", originType: "STAFF_GENERAL" });
    await pool.query(`UPDATE assignment SET created_at = now() - interval '2 days' WHERE id = $1`, [first]);
    const second = await createAssignment({ tenantId, classId, contentBundleId, status: "PUBLISHED", originType: "STAFF_GENERAL" });
    await pool.query(`UPDATE assignment SET created_at = now() - interval '1 day' WHERE id = $1`, [second]);
    const third = await createAssignment({ tenantId, classId, contentBundleId, status: "PUBLISHED", originType: "STAFF_GENERAL" });

    const repo = new AssignmentRepository(pool);
    const results = await repo.findByClassIdForStaff(classId, tenantId);
    expect(results.map((r) => r.id)).toEqual([third, second, first]);
  });
});
