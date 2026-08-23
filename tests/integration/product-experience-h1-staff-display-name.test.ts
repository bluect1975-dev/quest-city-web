import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { StaffAccountRepository, StaffClassAssignmentRepository } from "@quest-city-web/staff-identity";

/**
 * Pilot Product Experience Residual Closure, Tranche H1 — closes
 * `NEW-GAP-STAFF-DISPLAY-NAME-01`. Covers `StaffAccountRepository.
 * updateDisplayName` (self-service write) and `StaffClassAssignmentRepository.
 * findDisplayNamesByClass` (`GET /me/class`'s `teachers[]` aggregation) at
 * the repository level, same convention as
 * `product-experience-g2-me-class-security.test.ts` — `apps/api/app/me/**`
 * route handlers are thin composition over these already-tested
 * repositories.
 *
 *   DATABASE_URL=postgresql://quest_city_web:changeme_local_only@localhost:5556/quest_city_web \
 *     pnpm --filter @quest-city-web/tests-integration run test -- product-experience-h1-staff-display-name
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

async function createStaffAccount(): Promise<string> {
  return (
    await pool.query<{ id: string }>(
      `INSERT INTO staff_account (email, password_hash, password_algorithm, status, created_by_actor_type, created_by_actor_id, requires_password_setup)
       VALUES ($1, 'x', 'scrypt', 'ACTIVE', 'ADMIN_SEED_SCRIPT', 'test-fixture', false) RETURNING id`,
      [`teacher-${rnd()}@example.org`],
    )
  ).rows[0]!.id;
}

async function assignTeacherToClass(staffAccountId: string, tenantId: string, classId: string): Promise<void> {
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
}

afterAll(async () => {
  await truncateAll();
  await pool.end();
});

describe("StaffAccountRepository.updateDisplayName", () => {
  beforeEach(truncateAll);

  it("is null until set", async () => {
    const accountId = await createStaffAccount();
    const repo = new StaffAccountRepository(pool);
    const account = await repo.findById(accountId);
    expect(account?.displayName).toBeNull();
  });

  it("sets and persists a real display name", async () => {
    const accountId = await createStaffAccount();
    const repo = new StaffAccountRepository(pool);
    const updated = await repo.updateDisplayName(accountId, "Mario Rossi");
    expect(updated?.displayName).toBe("Mario Rossi");
    const reread = await repo.findById(accountId);
    expect(reread?.displayName).toBe("Mario Rossi");
  });

  it("updates an already-set display name (overwrite, not append)", async () => {
    const accountId = await createStaffAccount();
    const repo = new StaffAccountRepository(pool);
    await repo.updateDisplayName(accountId, "Mario Rossi");
    const updated = await repo.updateDisplayName(accountId, "Maria Rossi");
    expect(updated?.displayName).toBe("Maria Rossi");
  });

  it("never modifies a different account's display name", async () => {
    const accountId = await createStaffAccount();
    const otherAccountId = await createStaffAccount();
    const repo = new StaffAccountRepository(pool);
    await repo.updateDisplayName(accountId, "Mario Rossi");
    const other = await repo.findById(otherAccountId);
    expect(other?.displayName).toBeNull();
  });

  it("rejects a display name longer than 120 characters at the DB constraint layer", async () => {
    const accountId = await createStaffAccount();
    const repo = new StaffAccountRepository(pool);
    await expect(repo.updateDisplayName(accountId, "x".repeat(121))).rejects.toThrow();
  });
});

describe("StaffClassAssignmentRepository.findDisplayNamesByClass (GET /me/class teachers[])", () => {
  beforeEach(truncateAll);

  it("returns an empty array for a class with no teacher assigned yet", async () => {
    const tenantId = await createTenant("Empty School");
    const classId = await createClass(tenantId, "Unassigned Class");
    const repo = new StaffClassAssignmentRepository(pool);
    expect(await repo.findDisplayNamesByClass(classId, tenantId)).toEqual([]);
  });

  it("returns the real display name for a teacher who has set one", async () => {
    const tenantId = await createTenant("One Teacher School");
    const classId = await createClass(tenantId, "Class A");
    const staffAccountId = await createStaffAccount();
    await new StaffAccountRepository(pool).updateDisplayName(staffAccountId, "Anna Bianchi");
    await assignTeacherToClass(staffAccountId, tenantId, classId);
    const repo = new StaffClassAssignmentRepository(pool);
    expect(await repo.findDisplayNamesByClass(classId, tenantId)).toEqual([{ displayName: "Anna Bianchi" }]);
  });

  it("returns null (never a fabricated name, never email) for a teacher who has not set a display name", async () => {
    const tenantId = await createTenant("Legacy School");
    const classId = await createClass(tenantId, "Class B");
    const staffAccountId = await createStaffAccount();
    await assignTeacherToClass(staffAccountId, tenantId, classId);
    const repo = new StaffClassAssignmentRepository(pool);
    const rows = await repo.findDisplayNamesByClass(classId, tenantId);
    expect(rows).toEqual([{ displayName: null }]);
  });

  it("returns every co-teacher's name assigned to the class, named and unnamed mixed", async () => {
    const tenantId = await createTenant("Co-teaching School");
    const classId = await createClass(tenantId, "Class C");
    const named = await createStaffAccount();
    await new StaffAccountRepository(pool).updateDisplayName(named, "Mario Rossi");
    const unnamed = await createStaffAccount();
    await assignTeacherToClass(named, tenantId, classId);
    await assignTeacherToClass(unnamed, tenantId, classId);
    const repo = new StaffClassAssignmentRepository(pool);
    const rows = await repo.findDisplayNamesByClass(classId, tenantId);
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual({ displayName: "Mario Rossi" });
    expect(rows).toContainEqual({ displayName: null });
  });

  it("does not leak a teacher assigned to a different class in the same tenant", async () => {
    const tenantId = await createTenant("Multi-class School");
    const classId = await createClass(tenantId, "Class D");
    const otherClassId = await createClass(tenantId, "Class E");
    const staffAccountId = await createStaffAccount();
    await new StaffAccountRepository(pool).updateDisplayName(staffAccountId, "Should Not Appear");
    await assignTeacherToClass(staffAccountId, tenantId, otherClassId);
    const repo = new StaffClassAssignmentRepository(pool);
    expect(await repo.findDisplayNamesByClass(classId, tenantId)).toEqual([]);
  });

  it("does not leak a same-public-shape class row's teacher across tenants", async () => {
    const tenantId = await createTenant("School X");
    const otherTenantId = await createTenant("School Y");
    const classId = await createClass(tenantId, "Class F");
    const otherTenantClassId = await createClass(otherTenantId, "Class F");
    const staffAccountId = await createStaffAccount();
    await new StaffAccountRepository(pool).updateDisplayName(staffAccountId, "Other Tenant Teacher");
    await assignTeacherToClass(staffAccountId, otherTenantId, otherTenantClassId);
    const repo = new StaffClassAssignmentRepository(pool);
    expect(await repo.findDisplayNamesByClass(classId, tenantId)).toEqual([]);
    expect(await repo.findDisplayNamesByClass(otherTenantClassId, otherTenantId)).toEqual([{ displayName: "Other Tenant Teacher" }]);
  });
});
