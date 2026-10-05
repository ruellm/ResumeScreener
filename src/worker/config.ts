import { hostname } from "node:os";
import { z } from "zod";
// Fails fast when the shared env is incomplete.
import "@/lib/env.server";
import { DEFAULT_POLL_MS } from "@/lib/intake-status";

// Empty input means "use the default".
function intVar(defaultValue: number, min: number) {
  return z.preprocess(
    (value) => (value === "" || value == null ? undefined : value),
    z.coerce.number().int().min(min).default(defaultValue),
  );
}

const workerSchema = z.object({
  WORKER_CONCURRENCY: intVar(3, 1),
  WORKER_POLL_MS: intVar(2000, 100),
  WORKER_LEASE_SECONDS: intVar(300, 1),
  WORKER_STUB_DELAY_MS: intVar(1500, 0),
  EMAIL_POLL_MS: intVar(DEFAULT_POLL_MS, 1000),
  DRIVE_POLL_MS: intVar(DEFAULT_POLL_MS, 1000),
});

export const workerEnv = workerSchema.parse(process.env);

export const workerId = `${hostname()}-${process.pid}`;

export const MAX_ATTEMPTS = 3;

// Wait before retry, indexed by the attempt that just failed.
export const RETRY_BACKOFF_SECONDS = [30, 120];

export function log(message: string) {
  console.log(`${new Date().toISOString()} ${message}`);
}
