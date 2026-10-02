import { db } from "@/lib/db";
import { MAX_ATTEMPTS, workerEnv, workerId } from "./config";

export type Claim = { id: string; attempts: number };

export type SubmissionRef = { id: string; jobId: string; businessId: string };

export const LEASE_EXPIRED_ERROR = "Worker lease expired too many times";

// A single statement with no session state, so it works through the
// transaction pooler.
//
// The picked rows are a materialized CTE so the SELECT runs exactly once.
// As a plain "id IN (SELECT ... LIMIT n FOR UPDATE)" the planner may run the
// subquery once per row; each rerun skips the rows this statement already
// updated and returns the next n, so one claim can take far more than n rows.
export function claimSubmissions(limit: number) {
  return db.$queryRaw<Claim[]>`
    WITH picked AS MATERIALIZED (
      SELECT id FROM "Submission"
      WHERE (status = 'QUEUED' AND "availableAt" <= now())
         OR (status IN ('EXTRACTING', 'EVALUATING')
             AND "lockedUntil" < now()
             AND attempts < ${MAX_ATTEMPTS})
      ORDER BY "availableAt"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "Submission" AS s
    SET status = 'EXTRACTING',
        "lockedUntil" = now() + make_interval(secs => ${workerEnv.WORKER_LEASE_SECONDS}),
        "lockedBy" = ${workerId},
        attempts = s.attempts + 1,
        "updatedAt" = now()
    FROM picked
    WHERE s.id = picked.id
    RETURNING s.id, s.attempts`;
}

// Rows that lost their lease on the last allowed attempt are never claimed
// again, so they are failed here.
export function failExpiredSubmissions() {
  return db.$queryRaw<SubmissionRef[]>`
    UPDATE "Submission"
    SET status = 'FAILED',
        error = ${LEASE_EXPIRED_ERROR},
        "completedAt" = now(),
        "lockedUntil" = NULL,
        "lockedBy" = NULL,
        "updatedAt" = now()
    WHERE status IN ('EXTRACTING', 'EVALUATING')
      AND "lockedUntil" < now()
      AND attempts >= ${MAX_ATTEMPTS}
    RETURNING id, "jobId", "businessId"`;
}
