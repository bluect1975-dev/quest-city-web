import type { Queryable } from "./types";

export type StaffAccountStatus = "ACTIVE" | "SUSPENDED" | "DEACTIVATED";

/**
 * ADMIN_BOOTSTRAP_SCRIPT and PLATFORM_ADMIN added by migration 0006
 * (School Pilot Readiness Tranche A) -- the first origin for the
 * first-ever PLATFORM_ADMIN's own staff_account (02_38 §4.1, no public
 * self-registration), the second for a staff_account created by an
 * already-active PLATFORM_ADMIN via the school-admin activation flow
 * (02_38 §4.1 capability `school_admin.activate`).
 */
export type StaffAccountCreatedByActorType = "ADMIN_SEED_SCRIPT" | "ADMIN_BOOTSTRAP_SCRIPT" | "PLATFORM_ADMIN" | "SCHOOL_ADMIN";

export interface StaffAccount {
  id: string;
  email: string;
  passwordHash: string;
  passwordAlgorithm: "scrypt";
  status: StaffAccountStatus;
  failedLoginCount: number;
  lockedUntil: Date | null;
  createdByActorType: StaffAccountCreatedByActorType;
  createdByActorId: string;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
  /** School Onboarding + Staff Membership (02_35 v1.2 §11bis.3, migration 0008): true only for a brand-new identity created directly by createStaffInvitation with a placeholder credential — flipped to false the moment acceptStaffInvitation sets a real password. */
  requiresPasswordSetup: boolean;
  /** Pilot Product Experience Residual Closure (Tranche H1, migration 0017): self-chosen human-presentable name, set only via `PATCH /me/staff-profile`. NULL for every account that has never set one — never backfilled or defaulted from `email`. */
  displayName: string | null;
}

interface StaffAccountRow {
  id: string;
  email: string;
  password_hash: string;
  password_algorithm: "scrypt";
  status: StaffAccountStatus;
  failed_login_count: number;
  locked_until: Date | null;
  created_by_actor_type: StaffAccountCreatedByActorType;
  created_by_actor_id: string;
  created_at: Date;
  updated_at: Date;
  last_login_at: Date | null;
  requires_password_setup: boolean;
  display_name: string | null;
}

const SELECT_COLUMNS = `id, email, password_hash, password_algorithm, status, failed_login_count, locked_until,
       created_by_actor_type, created_by_actor_id, created_at, updated_at, last_login_at, requires_password_setup,
       display_name`;

function mapRow(row: StaffAccountRow): StaffAccount {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    passwordAlgorithm: row.password_algorithm,
    status: row.status,
    failedLoginCount: row.failed_login_count,
    lockedUntil: row.locked_until,
    createdByActorType: row.created_by_actor_type,
    createdByActorId: row.created_by_actor_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
    requiresPasswordSetup: row.requires_password_setup,
    displayName: row.display_name,
  };
}

/** `email` is always looked up already-normalized (lowercase/trim) by the caller — never normalized here (02_35 §2.3). */
export class StaffAccountRepository {
  constructor(private readonly db: Queryable) {}

  async findByEmail(email: string): Promise<StaffAccount | null> {
    const result = await this.db.query<StaffAccountRow>(`SELECT ${SELECT_COLUMNS} FROM staff_account WHERE email = $1`, [
      email,
    ]);
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  async findById(id: string): Promise<StaffAccount | null> {
    const result = await this.db.query<StaffAccountRow>(`SELECT ${SELECT_COLUMNS} FROM staff_account WHERE id = $1`, [id]);
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  /** Administrative offline/controlled provisioning only (02_35 §4.2, 02_38 §4.1) — no public self-registration endpoint exists. */
  async create(input: {
    email: string;
    passwordHash: string;
    status: StaffAccountStatus;
    createdByActorType?: StaffAccountCreatedByActorType;
    createdByActorId: string;
    /** School Onboarding + Staff Membership: true when `passwordHash` is a placeholder, never disclosed, meant to be replaced by acceptStaffInvitation. Defaults to false (every other creation path already discloses a real credential once). */
    requiresPasswordSetup?: boolean;
  }): Promise<StaffAccount> {
    const result = await this.db.query<StaffAccountRow>(
      `INSERT INTO staff_account (email, password_hash, password_algorithm, status, created_by_actor_type, created_by_actor_id, requires_password_setup)
       VALUES ($1, $2, 'scrypt', $3, $4, $5, $6)
       RETURNING ${SELECT_COLUMNS}`,
      [
        input.email,
        input.passwordHash,
        input.status,
        input.createdByActorType ?? "ADMIN_SEED_SCRIPT",
        input.createdByActorId,
        input.requiresPasswordSetup ?? false,
      ],
    );
    const [row] = result.rows;
    if (!row) throw new Error("INSERT ... RETURNING produced no row");
    return mapRow(row);
  }

  /** `acceptStaffInvitation` (02_35 §11bis.3): sets a real, human-chosen password and clears requiresPasswordSetup in the same write. */
  async setPasswordAndClearSetupFlag(id: string, passwordHash: string): Promise<StaffAccount | null> {
    const result = await this.db.query<StaffAccountRow>(
      `UPDATE staff_account SET password_hash = $2, requires_password_setup = false, updated_at = now()
       WHERE id = $1
       RETURNING ${SELECT_COLUMNS}`,
      [id, passwordHash],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }

  /** Successful login: resets the failure counter and lockout, records last_login_at. */
  async recordSuccessfulLogin(id: string): Promise<void> {
    await this.db.query(
      `UPDATE staff_account SET failed_login_count = 0, locked_until = NULL, last_login_at = now(), updated_at = now()
       WHERE id = $1`,
      [id],
    );
  }

  /**
   * Increments the failure counter and, once `maxFailedLoginAttempts` is
   * reached, sets `locked_until` (02_35 §4.5). Returns the updated
   * failure count and lock state so the caller can decide which error
   * code to raise without a second round-trip.
   */
  async recordFailedLogin(
    id: string,
    maxFailedLoginAttempts: number,
    lockoutDurationSeconds: number,
  ): Promise<{ failedLoginCount: number; lockedUntil: Date | null }> {
    const result = await this.db.query<{ failed_login_count: number; locked_until: Date | null }>(
      `UPDATE staff_account
       SET failed_login_count = failed_login_count + 1,
           updated_at = now(),
           locked_until = CASE
             WHEN failed_login_count + 1 >= $2 THEN now() + make_interval(secs => $3)
             ELSE locked_until
           END
       WHERE id = $1
       RETURNING failed_login_count, locked_until`,
      [id, maxFailedLoginAttempts, lockoutDurationSeconds],
    );
    const [row] = result.rows;
    if (!row) throw new Error("UPDATE ... RETURNING produced no row");
    return { failedLoginCount: row.failed_login_count, lockedUntil: row.locked_until };
  }

  /** Self-service only (`PATCH /me/staff-profile`, Tranche H1) — a staff member sets their own display name. `displayName` must already be trimmed/length-validated by the caller; the DB-level CHECK constraints (migration 0017) are a backstop, not the primary validation. */
  async updateDisplayName(id: string, displayName: string): Promise<StaffAccount | null> {
    const result = await this.db.query<StaffAccountRow>(
      `UPDATE staff_account SET display_name = $2, updated_at = now()
       WHERE id = $1
       RETURNING ${SELECT_COLUMNS}`,
      [id, displayName],
    );
    const [row] = result.rows;
    return row ? mapRow(row) : null;
  }
}
