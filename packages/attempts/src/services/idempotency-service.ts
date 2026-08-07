import { createHash } from "node:crypto";
import {
  IdempotencyRecordRepository,
  type IdempotencyBeginOutcome,
  type IdempotencyFinishOutcome,
} from "../repository/idempotency-record-repository";

function normalizedHash(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload ?? null)).digest("hex");
}

function scopeKeyFor(assignmentId: string, studentProfileId: string, idempotencyKey: string): string {
  return `${assignmentId}:${studentProfileId}:${idempotencyKey}`;
}

/**
 * IdempotencyService: completion-scope idempotency with generation-based
 * optimistic concurrency (07_15_01 v1.1 §10, §11-bis.6). Wraps
 * IdempotencyRecordRepository, computing the scope key and request hash so
 * callers never touch those directly.
 */
export class IdempotencyService {
  constructor(private readonly repository: IdempotencyRecordRepository) {}

  async begin(input: {
    tenantId: string;
    assignmentId: string;
    studentProfileId: string;
    idempotencyKey: string;
    payload: unknown;
  }): Promise<IdempotencyBeginOutcome> {
    return this.repository.begin({
      tenantId: input.tenantId,
      scopeKey: scopeKeyFor(input.assignmentId, input.studentProfileId, input.idempotencyKey),
      requestHash: normalizedHash(input.payload),
    });
  }

  async complete(input: {
    tenantId: string;
    assignmentId: string;
    studentProfileId: string;
    idempotencyKey: string;
    expectedGeneration: number;
    response: unknown;
  }): Promise<IdempotencyFinishOutcome> {
    return this.repository.complete({
      tenantId: input.tenantId,
      scopeKey: scopeKeyFor(input.assignmentId, input.studentProfileId, input.idempotencyKey),
      expectedGeneration: input.expectedGeneration,
      response: input.response,
    });
  }

  async fail(input: {
    tenantId: string;
    assignmentId: string;
    studentProfileId: string;
    idempotencyKey: string;
    expectedGeneration: number;
    retryable: boolean;
    response: unknown;
  }): Promise<IdempotencyFinishOutcome> {
    return this.repository.fail({
      tenantId: input.tenantId,
      scopeKey: scopeKeyFor(input.assignmentId, input.studentProfileId, input.idempotencyKey),
      expectedGeneration: input.expectedGeneration,
      retryable: input.retryable,
      response: input.response,
    });
  }
}
