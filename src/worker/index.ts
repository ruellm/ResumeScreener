import { setTimeout as sleep } from "node:timers/promises";
import { db } from "@/lib/db";
import {
  claimSubmissions,
  failExpiredSubmissions,
  LEASE_EXPIRED_ERROR,
  type Claim,
} from "./claim";
import { log, workerEnv, workerId } from "./config";
import { removeOrphanUploads } from "./orphans";
import { processSubmission, recordFailure } from "./pipeline";

const SHUTDOWN_GRACE_MS = 30_000;
const SWEEP_INTERVAL_MS = 10_000;

const inFlight = new Set<Promise<void>>();
const stop = new AbortController();
const stopped = new Promise<void>((resolve) => {
  stop.signal.addEventListener("abort", () => resolve());
});
let lastSweep = 0;

function start(claim: Claim) {
  const task = processSubmission(claim)
    .catch((error) => log(`${claim.id} error: ${describe(error)}`))
    .finally(() => inFlight.delete(task));
  inFlight.add(task);
  log(
    `${claim.id} claimed, attempt ${claim.attempts} (in flight ${inFlight.size}/${workerEnv.WORKER_CONCURRENCY})`,
  );
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function sweep() {
  if (Date.now() - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = Date.now();
  for (const submission of await failExpiredSubmissions()) {
    await recordFailure(submission, LEASE_EXPIRED_ERROR);
    log(`${submission.id} FAILED: ${LEASE_EXPIRED_ERROR}`);
  }
  await removeOrphanUploads();
}

async function idle(ms: number) {
  await sleep(ms, undefined, { signal: stop.signal }).catch(() => {});
}

async function loop() {
  while (!stop.signal.aborted) {
    const free = workerEnv.WORKER_CONCURRENCY - inFlight.size;
    if (free <= 0) {
      await Promise.race([...inFlight, stopped]);
      continue;
    }

    let claimed = 0;
    try {
      await sweep();
      const claims = await claimSubmissions(free);
      // A signal may arrive while the claim is running. The rows are already
      // claimed, so they are processed and waited for like any other.
      claims.forEach(start);
      claimed = claims.length;
    } catch (error) {
      log(`poll error: ${describe(error)}`);
    }

    // A full batch means there may be more queued, so wait for a free slot
    // on the next pass. Anything less means the queue is drained.
    if (claimed < free) await idle(workerEnv.WORKER_POLL_MS);
  }
}

function onSignal(signal: string) {
  if (stop.signal.aborted) return;
  log(`${signal} received, waiting for ${inFlight.size} in flight`);
  stop.abort();
}

async function main() {
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));

  log(
    `worker ${workerId} started (concurrency ${workerEnv.WORKER_CONCURRENCY}, poll ${workerEnv.WORKER_POLL_MS}ms, lease ${workerEnv.WORKER_LEASE_SECONDS}s)`,
  );

  await loop();

  const grace = new AbortController();
  const timedOut = await Promise.race([
    Promise.all(inFlight).then(() => false),
    sleep(SHUTDOWN_GRACE_MS, true, { signal: grace.signal }).catch(() => false),
  ]);
  grace.abort();
  if (timedOut) {
    log(`${inFlight.size} still in flight after ${SHUTDOWN_GRACE_MS / 1000}s, leaving them to the lease`);
  }

  await db.$disconnect();
  log("worker stopped");
  process.exit(timedOut ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  await db.$disconnect();
  process.exit(1);
});
