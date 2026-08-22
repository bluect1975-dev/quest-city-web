import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { StaffClassAssignmentRepository } from "@quest-city-web/staff-identity";

/**
 * Pilot Product Experience Remediation, Tranche G2 — `GET /me/class`'s
 * teacher-count aggregation (`StaffClassAssignmentRepository.findByClass`,
 * the inverse of the pre-existing `findByMembership`). Same fixture/test
 * style as `tranche-b-student-access-security.test.ts` — repository-level,
 * matching the existing convention that `apps/api/app/me/**` route
 * handlers are thin composition over already-tested repositories, verified
 * by direct route source inspection rather than a duplicate HTTP-level test.
 *
 *   DATABASE_URL=postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web \
 *     pnpm --filter @quest-city-web/tests-integration run test -- product-experience-g2-me-class-security
 */
const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web";

const pool = new Pool({ connectionString: DATABASE_URL });

function rnd(): string {
  return Math.random().toString(36).slice(2, 10);
}

async function truncateAll(): Promise<void> {
  await pool.query(
    "TRUNCATE staff_class_assignment, staff_tenant_membership, staff_account, school_class, tenant CASCADE",
  );
}

async function createTenant(name: string): Promise<string> {
  return (
    await pool.query<{ id: string }>(
      `INSERT INTO tenant (public_id, type, status, name) VALUES ($1, 'SCHOOL', 'ACTIVE', $2) RETURNING id`,
      [`sch_${rnd()}`, name],
    )
  ).rows[0]!.id;
}

async function createClass(tenantId: string, name: string): Promise<string> {
  return (
    await pool.query<{ id: string }>(
      `INSERT INTO school_class (tenant_id, public_id, name, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
      [tenantId, `cls_${rnd()}`, name],
    )
  ).rows[0]!.id;
}

async function createTeacherAssignedToClass(tenantId: string, classId: string): Promise<string> {
  const staffAccountId = (
    await pool.query<{ id: string }>(
      `INSERT INTO staff_account (email, password_hash, password_algorithm, status, created_by_actor_type, created_by_actor_id, requires_password_setup)
       VALUES ($1, 'x', 'scrypt', 'ACTIVE', 'ADMIN_SEED_SCRIPT', 'test-fixture', false) RETURNING id`,
      [`teacher-${rnd()}@example.org`],
    )
  ).rows[0]!.id;
  const membershipId = (
    await pool.query<{ id: string }>(
      `INSERT INTO staff_tenant_membership (staff_account_id, tenant_id, role, status) VALUES ($1, $2, 'TEACHER', 'ACTIVE') RETURNING id`,
      [staffAccountId, tenantId],
    )
  ).rows[0]!.id;
  await pool.query(`INSERT INTO staff_class_assignment (staff_tenant_membership_id, tenant_id, class_id) VALUES ($1, $2, $3)`, [
    membershipId,
    tenantId,
    classId,
  ]);
  return membershipId;
}

afterAll(async () => {
  await truncateAll();
  await pool.end();
});

describe("StaffClassAssignmentRepository.findByClass (GET /me/class teacher count)", () => {
  beforeEach(truncateAll);

  it("returns zero for a class with no teacher assigned yet", async () => {
    const tenantId = await createTenant("Empty School");
    const classId = await createClass(tenantId, "Unassigned Class");
    const repo = new StaffClassAssignmentRepository(pool);
    expect(await repo.findByClass(classId, tenantId)).toHaveLength(0);
  });

  it("returns one row for one assigned teacher", async () => {
    const tenantId = await createTenant("One Teacher School");
    const classId = await createClass(tenantId, "Class A");
    await createTeacherAssignedToClass(tenantId, classId);
    const repo = new StaffClassAssignmentRepository(pool);
    expect(await repo.findByClass(classId, tenantId)).toHaveLength(1);
  });

  it("returns every teacher assigned to the class, including co-teachers", async () => {
    const tenantId = await createTenant("Co-teaching School");
    const classId = await createClass(tenantId, "Class B");
    await createTeacherAssignedToClass(tenantId, classId);
    await createTeacherAssignedToClass(tenantId, classId);
    await createTeacherAssignedToClass(tenantId, classId);
    const repo = new StaffClassAssignmentRepository(pool);
    expect(await repo.findByClass(classId, tenantId)).toHaveLength(3);
  });

  it("does not count a teacher assigned to a different class in the same tenant", async () => {
    const tenantId = await createTenant("Multi-class School");
    const classId = await createClass(tenantId, "Class C");
    const otherClassId = await createClass(tenantId, "Class D");
    await createTeacherAssignedToClass(tenantId, otherClassId);
    const repo = new StaffClassAssignmentRepository(pool);
    expect(await repo.findByClass(classId, tenantId)).toHaveLength(0);
  });

  it("does not count a same-public-shape class row belonging to another tenant (tenant_id AND class_id both required)", async () => {
    const tenantId = await createTenant("School X");
    const otherTenantId = await createTenant("School Y");
    const classId = await createClass(tenantId, "Class E");
    const otherTenantClassId = await createClass(otherTenantId, "Class E");
    await createTeacherAssignedToClass(otherTenantId, otherTenantClassId);
    const repo = new StaffClassAssignmentRepository(pool);
    // Same-named class in a different tenant must never leak its teacher count into this one.
    expect(await repo.findByClass(classId, tenantId)).toHaveLength(0);
    expect(await repo.findByClass(otherTenantClassId, otherTenantId)).toHaveLength(1);
  });
});
