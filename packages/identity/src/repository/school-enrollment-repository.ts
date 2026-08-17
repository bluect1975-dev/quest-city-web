import type { Queryable } from "./types";

export type SchoolEnrollmentStatus = "INVITED" | "ACTIVE" | "SUSPENDED" | "LEFT" | "ARCHIVED";

export interface SchoolEnrollment {
  id: string;
  tenantId: string;
  classId: string;
  studentProfileId: string;
  accessAlias: string;
  accessAliasNormalized: string;
  pinHash: string;
  status: SchoolEnrollmentStatus;
  pathId: string | null;
  validFrom: Date;
  validUntil: Date | null;
  createdAt: Date;
}

interface SchoolEnrollmentRow {
  id: string;
  tenant_id: string;
  class_id: string;
  student_profile_id: string;
  access_alias: string;
  access_alias_normalized: string;
  pin_hash: string;
  status: SchoolEnrollmentStatus;
  path_id: string | null;
  valid_from: Date;
  valid_until: Date | null;
  created_at: Date;
}

function mapEnrollment(row: SchoolEnrollmentRow): SchoolEnrollment {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    classId: row.class_id,
    studentProfileId: row.student_profile_id,
    accessAlias: row.access_alias,
    accessAliasNormalized: row.access_alias_normalized,
    pinHash: row.pin_hash,
    status: row.status,
    pathId: row.path_id,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    createdAt: row.created_at,
  };
}

const SELECT_COLUMNS = `id, tenant_id, class_id, student_profile_id, access_alias, access_alias_normalized,
       pin_hash, status, path_id, valid_from, valid_until, created_at`;

export class SchoolEnrollmentRepository {
  constructor(private readonly db: Queryable) {}

  async findByClassAndAliasNormalized(classId: string, aliasNormalized: string): Promise<SchoolEnrollment | null> {
    const result = await this.db.query<SchoolEnrollmentRow>(
      `SELECT ${SELECT_COLUMNS} FROM school_enrollment WHERE class_id = $1 AND access_alias_normalized = $2`,
      [classId, aliasNormalized],
    );
    const [row] = result.rows;
    return row ? mapEnrollment(row) : null;
  }

  async findById(id: string, tenantId: string): Promise<SchoolEnrollment | null> {
    const result = await this.db.query<SchoolEnrollmentRow>(
      `SELECT ${SELECT_COLUMNS} FROM school_enrollment WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    const [row] = result.rows;
    return row ? mapEnrollment(row) : null;
  }

  /**
   * WEB-M3B (02_35 §5): full class roster for a staff-scoped read. The
   * caller is responsible for never projecting `pinHash` into a staff-facing
   * response (OpenAPI v1.6 `StudentRosterEntry` has no such field).
   */
  async findByClass(classId: string, tenantId: string): Promise<SchoolEnrollment[]> {
    const result = await this.db.query<SchoolEnrollmentRow>(
      `SELECT ${SELECT_COLUMNS} FROM school_enrollment WHERE class_id = $1 AND tenant_id = $2 ORDER BY access_alias ASC`,
      [classId, tenantId],
    );
    return result.rows.map(mapEnrollment);
  }

  /** WEB-M3B (02_35 §5): a specific student's enrollment within a specific class, for scope verification. */
  async findByClassAndStudent(classId: string, studentProfileId: string, tenantId: string): Promise<SchoolEnrollment | null> {
    const result = await this.db.query<SchoolEnrollmentRow>(
      `SELECT ${SELECT_COLUMNS} FROM school_enrollment WHERE class_id = $1 AND student_profile_id = $2 AND tenant_id = $3`,
      [classId, studentProfileId, tenantId],
    );
    const [row] = result.rows;
    return row ? mapEnrollment(row) : null;
  }

  /**
   * GLPC (02_41 §10, migration 0013): the student's current (non-terminal)
   * class enrollment -- used to resolve CLASS-scope hard-lock policies when
   * writing a STUDENT-scope policy. A student is expected to have at most
   * one non-terminal enrollment at a time; if more than one exists, the
   * most recently started one wins.
   */
  async findCurrentByStudent(studentProfileId: string, tenantId: string): Promise<SchoolEnrollment | null> {
    const result = await this.db.query<SchoolEnrollmentRow>(
      `SELECT ${SELECT_COLUMNS} FROM school_enrollment
       WHERE student_profile_id = $1 AND tenant_id = $2 AND status IN ('ACTIVE', 'INVITED', 'SUSPENDED')
       ORDER BY valid_from DESC LIMIT 1`,
      [studentProfileId, tenantId],
    );
    const [row] = result.rows;
    return row ? mapEnrollment(row) : null;
  }

  /**
   * Activates an INVITED enrollment as a side effect of the first
   * successful `session/start` (02_26 §30.6 — no dedicated
   * `student-enrollments/accept` endpoint exists). No-op (returns the
   * row unchanged) if the enrollment is not currently INVITED.
   */
  async activateIfInvited(id: string, tenantId: string): Promise<SchoolEnrollment | null> {
    const result = await this.db.query<SchoolEnrollmentRow>(
      `UPDATE school_enrollment SET status = 'ACTIVE'
       WHERE id = $1 AND tenant_id = $2 AND status = 'INVITED'
       RETURNING ${SELECT_COLUMNS}`,
      [id, tenantId],
    );
    const [activatedRow] = result.rows;
    if (activatedRow) {
      return mapEnrollment(activatedRow);
    }
    return this.findById(id, tenantId);
  }

  /**
   * `DELETE /classes/{classId}/students/{studentProfileId}` (02_35 v1.2
   * §11bis.7) — always a soft transition, never a delete. Only legal
   * source states are INVITED/ACTIVE/SUSPENDED (checked by the caller,
   * which raises ENROLLMENT_NOT_ACTIVE for LEFT/ARCHIVED); this method
   * itself is a plain unconditional status write, since the precondition
   * check already happened against the freshly-read row.
   */
  async setStatus(id: string, tenantId: string, status: SchoolEnrollmentStatus): Promise<SchoolEnrollment | null> {
    const result = await this.db.query<SchoolEnrollmentRow>(
      `UPDATE school_enrollment SET status = $3 WHERE id = $1 AND tenant_id = $2
       RETURNING ${SELECT_COLUMNS}`,
      [id, tenantId, status],
    );
    const [row] = result.rows;
    return row ? mapEnrollment(row) : null;
  }

  /** Administrative provisioning only (seed), plus School Onboarding + Staff Membership's `addStudentToRoster` (02_35 §11bis.7). */
  async create(input: {
    tenantId: string;
    classId: string;
    studentProfileId: string;
    accessAlias: string;
    accessAliasNormalized: string;
    pinHash: string;
    status: SchoolEnrollmentStatus;
    pathId?: string | null;
    validUntil?: Date | null;
  }): Promise<SchoolEnrollment> {
    const result = await this.db.query<SchoolEnrollmentRow>(
      `INSERT INTO school_enrollment
         (tenant_id, class_id, student_profile_id, access_alias, access_alias_normalized, pin_hash, status, path_id, valid_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${SELECT_COLUMNS}`,
      [
        input.tenantId,
        input.classId,
        input.studentProfileId,
        input.accessAlias,
        input.accessAliasNormalized,
        input.pinHash,
        input.status,
        input.pathId ?? null,
        input.validUntil ?? null,
      ],
    );
    const [row] = result.rows;
    if (!row) {
      throw new Error("INSERT ... RETURNING produced no row");
    }
    return mapEnrollment(row);
  }
}
