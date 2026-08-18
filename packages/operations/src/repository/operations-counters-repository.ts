import type { Queryable } from "./types";

export interface TenantCounts {
  schoolsTotal: number;
  schoolsActive: number;
  schoolsSuspended: number;
  independentEducatorsTotal: number;
  independentEducatorsActive: number;
  independentEducatorsSuspended: number;
  classesTotal: number;
}

export interface StaffRoleCount {
  role: string;
  activeMemberships: number;
  uniqueHumans: number;
}

export interface StudentCounts {
  studentsEnrolled: number;
  enrollmentRows: number;
}

/**
 * Batched aggregate SQL only -- one query per KPI group, never a query per
 * school/student (02_42 §10-12, mission §16/§49 no-N+1 requirement).
 */
export class OperationsCountersRepository {
  constructor(private readonly db: Queryable) {}

  /** Independent Educator tenants never silently counted as schools (02_42 §10). */
  async tenantCounts(): Promise<TenantCounts> {
    const result = await this.db.query<{
      schools_total: string;
      schools_active: string;
      schools_suspended: string;
      independent_educators_total: string;
      independent_educators_active: string;
      independent_educators_suspended: string;
      classes_total: string;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE type = 'SCHOOL') AS schools_total,
         COUNT(*) FILTER (WHERE type = 'SCHOOL' AND status = 'ACTIVE') AS schools_active,
         COUNT(*) FILTER (WHERE type = 'SCHOOL' AND status = 'SUSPENDED') AS schools_suspended,
         COUNT(*) FILTER (WHERE type = 'INDEPENDENT_EDUCATOR') AS independent_educators_total,
         COUNT(*) FILTER (WHERE type = 'INDEPENDENT_EDUCATOR' AND status = 'ACTIVE') AS independent_educators_active,
         COUNT(*) FILTER (WHERE type = 'INDEPENDENT_EDUCATOR' AND status = 'SUSPENDED') AS independent_educators_suspended,
         (SELECT COUNT(*) FROM school_class WHERE status = 'ACTIVE') AS classes_total
       FROM tenant`,
    );
    const row = result.rows[0];
    return {
      schoolsTotal: Number(row?.schools_total ?? 0),
      schoolsActive: Number(row?.schools_active ?? 0),
      schoolsSuspended: Number(row?.schools_suspended ?? 0),
      independentEducatorsTotal: Number(row?.independent_educators_total ?? 0),
      independentEducatorsActive: Number(row?.independent_educators_active ?? 0),
      independentEducatorsSuspended: Number(row?.independent_educators_suspended ?? 0),
      classesTotal: Number(row?.classes_total ?? 0),
    };
  }

  /**
   * Per role: both active-memberships (row count) and unique-humans
   * (DISTINCT staff_account_id) -- 02_42 §11, never collapsed into a
   * single number, never confused with each other.
   */
  async staffCountsByRole(): Promise<StaffRoleCount[]> {
    const result = await this.db.query<{ role: string; active_memberships: string; unique_humans: string }>(
      `SELECT role,
              COUNT(*) AS active_memberships,
              COUNT(DISTINCT staff_account_id) AS unique_humans
       FROM staff_tenant_membership
       WHERE status = 'ACTIVE'
       GROUP BY role`,
    );
    return result.rows.map((row) => ({
      role: row.role,
      activeMemberships: Number(row.active_memberships),
      uniqueHumans: Number(row.unique_humans),
    }));
  }

  /** Deduplicated on staff_account_id across every role (ONE HUMAN -> ONE PLATFORM IDENTITY, 02_42 §11). */
  async totalUniqueStaffHumans(): Promise<number> {
    const result = await this.db.query<{ count: string }>(
      `SELECT COUNT(DISTINCT staff_account_id) AS count FROM staff_tenant_membership WHERE status = 'ACTIVE'`,
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  /** Students enrolled = distinct student_profile with >=1 ACTIVE enrollment, platform-wide, never double-counted cross-class (02_42 §12). */
  async studentCounts(): Promise<StudentCounts> {
    const result = await this.db.query<{ students_enrolled: string; enrollment_rows: string }>(
      `SELECT
         (SELECT COUNT(DISTINCT student_profile_id) FROM school_enrollment WHERE status = 'ACTIVE') AS students_enrolled,
         (SELECT COUNT(*) FROM school_enrollment WHERE status = 'ACTIVE') AS enrollment_rows`,
    );
    const row = result.rows[0];
    return {
      studentsEnrolled: Number(row?.students_enrolled ?? 0),
      enrollmentRows: Number(row?.enrollment_rows ?? 0),
    };
  }

  async activeLearningAttempts(): Promise<number> {
    const result = await this.db.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM learning_attempt WHERE attempt_state = 'IN_PROGRESS'`,
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async attemptsStartedSince(since: Date): Promise<number> {
    const result = await this.db.query<{ count: string }>(`SELECT COUNT(*) AS count FROM learning_attempt WHERE started_at >= $1`, [
      since,
    ]);
    return Number(result.rows[0]?.count ?? 0);
  }
}
