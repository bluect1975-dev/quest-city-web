import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { AuditRepository } from "@quest-city-web/identity";
import { IdempotencyRecordRepository } from "@quest-city-web/attempts";
import { StaffIdentityError } from "../errors";
import {
  ReviewQueueItemRepository,
  type ReviewQueueItem,
  type ReviewQueueItemPriority,
  type ReviewQueueItemStatus,
} from "../repository/review-queue-item-repository";
import type { StaffInternalIdentity } from "./staff-auth-service";
import { isClassInScope } from "./authorization";

const IDEMPOTENCY_SCOPE = "staff_review_transition";

/** Lifecycle transitions fixed by 02_35 §7.2 — any pair not listed here is VALIDATION_ERROR (409). */
const ALLOWED_TRANSITIONS: Record<ReviewQueueItemStatus, ReviewQueueItemStatus[]> = {
  OPEN: ["IN_REVIEW", "RESOLVED", "DISMISSED"],
  IN_REVIEW: ["OPEN", "RESOLVED", "DISMISSED"],
  RESOLVED: ["OPEN"],
  DISMISSED: ["OPEN"],
};

function requestHashFor(targetStatus: ReviewQueueItemStatus): string {
  return createHash("sha256").update(JSON.stringify({ targetStatus })).digest("hex");
}

/**
 * `GET /review`, `POST /review/{reviewItemId}/status` (02_35 §7). A
 * single parametric transition endpoint (claim/release/resolve/dismiss/
 * reopen) rather than one per action, matching the OpenAPI v1.6 surface.
 */
export class ReviewService {
  private readonly items: ReviewQueueItemRepository;
  private readonly idempotency: IdempotencyRecordRepository;
  private readonly audit: AuditRepository;

  constructor(pool: Pool) {
    this.items = new ReviewQueueItemRepository(pool);
    this.idempotency = new IdempotencyRecordRepository(pool);
    this.audit = new AuditRepository(pool);
  }

  /** Access to the review queue is itself an audited action (AGENTS.md §4.22 rule 10), not only its mutations. */
  async list(
    identity: StaffInternalIdentity,
    filter: { classId?: string | undefined; status?: ReviewQueueItemStatus | undefined; priority?: ReviewQueueItemPriority | undefined },
  ): Promise<ReviewQueueItem[]> {
    if (filter.classId && !isClassInScope(identity, filter.classId)) {
      return [];
    }
    const items = await this.items.findByScope(identity.tenantId, {
      classIds: identity.role === "TEACHER" ? (identity.classScope ?? []) : null,
      classId: filter.classId,
      status: filter.status ? [filter.status] : undefined,
      priority: filter.priority ? [filter.priority] : undefined,
    });
    await this.audit.record({
      tenantId: identity.tenantId,
      actorType: "STAFF",
      actorId: identity.staffAccountId,
      action: "staff_review_queue_accessed",
      targetType: "review_queue_item",
      result: "SUCCESS",
      metadataRedacted: { classId: filter.classId ?? null, resultCount: items.length },
    });
    return items;
  }

  async transitionStatus(input: {
    identity: StaffInternalIdentity;
    reviewItemId: string;
    targetStatus: ReviewQueueItemStatus;
    ifMatchVersion: number;
    idempotencyKey: string;
  }): Promise<ReviewQueueItem> {
    const { identity, reviewItemId, targetStatus, ifMatchVersion, idempotencyKey } = input;

    const item = await this.items.findById(reviewItemId, identity.tenantId);
    if (!item || !isClassInScope(identity, item.classId)) {
      throw new StaffIdentityError("REVIEW_ITEM_NOT_FOUND");
    }

    // Idempotency is checked BEFORE transition-validity: a replay of an
    // already-applied transition finds the item in its POST-transition
    // state, where re-validating the OLD transition would incorrectly
    // reject it as no longer allowed (e.g. a second identical
    // OPEN -> IN_REVIEW replay, seeing the item already IN_REVIEW).
    const scopeKey = `${reviewItemId}:${idempotencyKey}`;
    const begin = await this.idempotency.begin({
      tenantId: identity.tenantId,
      scope: IDEMPOTENCY_SCOPE,
      scopeKey,
      requestHash: requestHashFor(targetStatus),
    });
    if (begin.outcome === "DUPLICATE_SAME_PAYLOAD") {
      return begin.response as ReviewQueueItem;
    }
    if (begin.outcome === "CONFLICT_DIFFERENT_PAYLOAD" || begin.outcome === "RETRY_TOO_SOON") {
      throw new StaffIdentityError("IDEMPOTENCY_CONFLICT", "Idempotency-Key riutilizzata con un payload diverso.");
    }
    if (begin.outcome === "FAILED_TERMINAL") {
      throw new StaffIdentityError("VALIDATION_ERROR", "La richiesta precedente con questa chiave è fallita in modo definitivo.");
    }

    if (!ALLOWED_TRANSITIONS[item.status].includes(targetStatus)) {
      await this.idempotency.fail({
        tenantId: identity.tenantId,
        scope: IDEMPOTENCY_SCOPE,
        scopeKey,
        expectedGeneration: begin.generation,
        retryable: false,
        response: { error: "invalid_transition" },
      });
      throw new StaffIdentityError(
        "VALIDATION_ERROR",
        `Transizione non consentita: ${item.status} -> ${targetStatus} (02_35 §7.2).`,
      );
    }

    try {
      const updated = await this.items.transitionStatus(
        reviewItemId,
        identity.tenantId,
        ifMatchVersion,
        targetStatus,
        targetStatus === "OPEN" ? null : identity.staffAccountId,
      );
      if (!updated) {
        // Distinguish a stale If-Match from a status that changed concurrently under our feet.
        const current = await this.items.findById(reviewItemId, identity.tenantId);
        await this.idempotency.fail({
          tenantId: identity.tenantId,
          scope: IDEMPOTENCY_SCOPE,
          scopeKey,
          expectedGeneration: begin.generation,
          retryable: true,
          response: { error: "version_mismatch" },
        });
        if (current && current.version !== ifMatchVersion) {
          throw new StaffIdentityError("ETAG_MISMATCH", "If-Match non corrisponde alla versione corrente.");
        }
        throw new StaffIdentityError(
          "VALIDATION_ERROR",
          `Transizione non consentita: ${current?.status ?? item.status} -> ${targetStatus} (02_35 §7.2).`,
        );
      }

      await this.idempotency.complete({
        tenantId: identity.tenantId,
        scope: IDEMPOTENCY_SCOPE,
        scopeKey,
        expectedGeneration: begin.generation,
        response: updated,
      });
      await this.audit.record({
        tenantId: identity.tenantId,
        actorType: "STAFF",
        actorId: identity.staffAccountId,
        action: "staff_review_item_transitioned",
        targetType: "review_queue_item",
        targetId: reviewItemId,
        result: "SUCCESS",
        metadataRedacted: { fromStatus: item.status, toStatus: targetStatus },
      });
      return updated;
    } catch (error) {
      if (!(error instanceof StaffIdentityError)) {
        await this.idempotency.fail({
          tenantId: identity.tenantId,
          scope: IDEMPOTENCY_SCOPE,
          scopeKey,
          expectedGeneration: begin.generation,
          retryable: true,
          response: { error: error instanceof Error ? error.message : String(error) },
        });
      }
      throw error;
    }
  }
}
