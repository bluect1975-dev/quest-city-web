import type { Queryable } from "./types";

export type StudentProfileStatus = "ACTIVE" | "SUSPENDED" | "ARCHIVED";

export interface StudentProfile {
  id: string;
  tenantId: string;
  studentPublicId: string;
  status: StudentProfileStatus;
  createdAt: Date;
}

interface StudentProfileRow {
  id: string;
  tenant_id: string;
  student_public_id: string;
  status: StudentProfileStatus;
  created_at: Date;
}

function mapStudentProfile(row: StudentProfileRow): StudentProfile {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    studentPublicId: row.student_public_id,
    status: row.status,
    createdAt: row.created_at,
  };
}

export class StudentProfileRepository {
  constructor(private readonly db: Queryable) {}

  async findById(id: string, tenantId: string): Promise<StudentProfile | null> {
    const result = await this.db.query<StudentProfileRow>(
      `SELECT id, tenant_id, student_public_id, status, created_at
       FROM student_profile WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    const [row] = result.rows;
    return row ? mapStudentProfile(row) : null;
  }

  /** `student_public_id` is globally unique (migration 0002) — same lookup-by-public-id shape as `SchoolClassRepository.findByPublicId`. Callers must still verify `tenantId` matches (School Onboarding + Staff Membership's `addStudentToRoster` mode=EXISTING, 02_35 §11bis.7). */
  async findByPublicId(studentPublicId: string): Promise<StudentProfile | null> {
    const result = await this.db.query<StudentProfileRow>(
      `SELECT id, tenant_id, student_public_id, status, created_at FROM student_profile WHERE student_public_id = $1`,
      [studentPublicId],
    );
    const [row] = result.rows;
    return row ? mapStudentProfile(row) : null;
  }

  /** Administrative provisioning only (seed). */
  async create(input: { tenantId: string; studentPublicId: string; status: StudentProfileStatus }): Promise<StudentProfile> {
    const result = await this.db.query<StudentProfileRow>(
      `INSERT INTO student_profile (tenant_id, student_public_id, status)
       VALUES ($1, $2, $3)
       RETURNING id, tenant_id, student_public_id, status, created_at`,
      [input.tenantId, input.studentPublicId, input.status],
    );
    const [row] = result.rows;
    if (!row) {
      throw new Error("INSERT ... RETURNING produced no row");
    }
    return mapStudentProfile(row);
  }
}
