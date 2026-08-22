import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { AuditRepository, SchoolClassRepository } from "@quest-city-web/identity";
import { AssignmentRepository, ContentBundleRepository, IdempotencyRecordRepository, type AssignmentStatus } from "@quest-city-web/attempts";
import { StaffIdentityError } from "../errors";
import { assertStaffCapability } from "./capability";
import { assertClassInScope } from "./authorization";
import type { StaffInternalIdentity } from "./staff-auth-service";

const IDEMPOTENCY_SCOPE = "staff_general_assignment_create";

export interface GeneralAssignmentResult {
  assignmentId: string;
  classId: string;
  title: string;
  status: AssignmentStatus;
  originType: "STAFF_GENERAL";
  createdAt: string;
}

function requestHashOf(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload ?? null)).digest("hex");
}

/**
 * `POST /assignments` (02_35 v1.2 §11bis.8-§11bis.9) — the second,
 * narrowly-scoped exception to AGENTS.md rule 16 (§4.21), distinct from
 * and not a replacement for recovery-assignment
 * (`RecoveryAssignmentService`). Reuses the existing `assignment` table
 * exactly as recovery-assignment already does: `origin_type` gains its
 * third value, `STAFF_GENERAL`, `target_student_profile_id` stays NULL
 * (class-wide visibility, same behaviour as `ADMIN_SEED`) — no second
 * assignment model, no new student-facing plumbing. `SCHOOL_ADMIN` may
 * target any class in the tenant; `TEACHER` only classes in their own
 * `classScope` (enforced by `assertClassInScope`, same as every other
 * class-scoped operation in this package).
 */
export class GeneralAssignmentService {
  private readonly classes: SchoolClassRepository;
  private readonly contentBundles: ContentBundleRepository;
  private readonly assignments: AssignmentRepository;
  private readonly idempotency: IdempotencyRecordRepository;
  private readonly audit: AuditRepository;

  constructor(pool: Pool) {
    this.classes = new SchoolClassRepository(pool);
    this.contentBundles = new ContentBundleRepository(pool);
    this.assignments = new AssignmentRepository(pool);
    this.idempotency = new IdempotencyRecordRepository(pool);
    this.audit = new AuditRepository(pool);
  }

  async create(input: {
    identity: StaffInternalIdentity;
    classId: string;
    contentBundleId: string;
    title: string;
    allowedRuntimeChannels: Array<"WEB" | "ROBLOX">;
    opensAt: Date | null;
    dueAt: Date | null;
    idempotencyKey: string;
  }): Promise<GeneralAssignmentResult> {
    const { identity, classId, contentBundleId, title, allowedRuntimeChannels } = input;
    assertStaffCapability(identity, "assignment.create");
    assertClassInScope(identity, classId);

    const scopeKey = input.idempotencyKey;
    const begin = await this.idempotency.begin({
      tenantId: identity.tenantId,
      scope: IDEMPOTENCY_SCOPE,
      scopeKey,
      requestHash: requestHashOf({ classId, contentBundleId, title, allowedRuntimeChannels }),
    });
    if (begin.outcome === "DUPLICATE_SAME_PAYLOAD") {
      return begin.response as GeneralAssignmentResult;
    }
    if (begin.outcome === "CONFLICT_DIFFERENT_PAYLOAD") {
      throw new StaffIdentityError("IDEMPOTENCY_CONFLICT", "Idempotency-Key riutilizzata con un payload diverso.");
    }
    if (begin.outcome === "RETRY_TOO_SOON") {
      throw new StaffIdentityError("IDEMPOTENCY_IN_PROGRESS", "Richiesta con la stessa Idempotency-Key già in corso.", {
        retryAfterSeconds: begin.retryAfterSeconds,
      });
    }
    if (begin.outcome === "FAILED_TERMINAL") {
      throw new StaffIdentityError("IDEMPOTENCY_IN_PROGRESS", "La richiesta precedente con questa chiave è fallita in modo definitivo.");
    }

    try {
      const schoolClass = await this.classes.findById(classId, identity.tenantId);
      if (!schoolClass) {
        throw new StaffIdentityError("CLASS_ACCESS_DENIED");
      }
      // `contentBundleId` here is the caller-facing PUBLIC id (`bnd_...` — the
      // only form of this identifier ever surfaced to staff, e.g. via the
      // dashboard's "assign content" form): resolved to the internal uuid
      // before any further use. Looking this up by internal id instead (as a
      // prior version of this method did) crashed with an uncaught Postgres
      // "invalid input syntax for type uuid" on any real public-id input —
      // an ungraceful 500 (INTERNAL_ERROR) instead of a proper 404-shaped
      // ASSIGNMENT_CONTENT_NOT_PUBLISHED/validation error, found live during
      // the Pilot UX/UI Redesign mission's own user-acceptance test.
      const contentBundle = await this.contentBundles.findByPublicId(contentBundleId);
      if (!contentBundle || contentBundle.status !== "PUBLISHED") {
        throw new StaffIdentityError("ASSIGNMENT_CONTENT_NOT_PUBLISHED");
      }

      const created = await this.assignments.create({
        tenantId: identity.tenantId,
        classId,
        publicId: `general-${randomUUID()}`,
        title,
        // Created directly PUBLISHED — visible immediately, same
        // immediate-visibility posture already established by
        // recovery-assignment (02_35 §11.4).
        status: "PUBLISHED",
        opensAt: input.opensAt,
        dueAt: input.dueAt,
        createdByActorType: "STAFF",
        createdByActorId: identity.staffAccountId,
        completionPolicy: "FIRST_VALID_COMPLETION",
        // The resolved internal uuid — never the raw public-id input, which
        // is not a valid value for this column (a real FK to content_bundle.id).
        contentBundleId: contentBundle.id,
        allowedRuntimeChannels,
        originType: "STAFF_GENERAL",
        targetStudentProfileId: null,
      });

      const result: GeneralAssignmentResult = {
        assignmentId: created.id,
        classId: created.classId,
        title: created.title,
        status: created.status,
        originType: "STAFF_GENERAL",
        createdAt: created.createdAt.toISOString(),
      };

      await this.idempotency.complete({
        tenantId: identity.tenantId,
        scope: IDEMPOTENCY_SCOPE,
        scopeKey,
        expectedGeneration: begin.generation,
        response: result,
      });
      // metadataRedacted.originType disambiguates this event from the
      // pre-existing staff_recovery_assignment_created (02_35 §11bis.12).
      await this.audit.record({
        tenantId: identity.tenantId,
        actorType: "STAFF",
        actorId: identity.staffAccountId,
        action: "assignment_created",
        targetType: "assignment",
        targetId: created.id,
        result: "SUCCESS",
        metadataRedacted: { originType: "STAFF_GENERAL" },
      });

      return result;
    } catch (error) {
      await this.idempotency.fail({
        tenantId: identity.tenantId,
        scope: IDEMPOTENCY_SCOPE,
        scopeKey,
        expectedGeneration: begin.generation,
        retryable: !(error instanceof StaffIdentityError),
        response: { error: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }
}
