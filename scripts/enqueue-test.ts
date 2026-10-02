import { db } from "@/lib/db";

const USAGE =
  "Usage: npm run enqueue-test -- <jobId> [count] [--fail]\n" +
  "       npm run enqueue-test -- --cleanup";

// Marks rows made by this script so cleanup can find them.
const TEST_SHA256 = "test";

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--cleanup")) {
    const { count } = await db.submission.deleteMany({ where: { sha256: TEST_SHA256 } });
    console.log(`Deleted ${count} test submissions.`);
    return;
  }

  const fail = args.includes("--fail");
  const [jobId, countArg] = args.filter((arg) => !arg.startsWith("--"));
  const count = countArg === undefined ? 3 : Number(countArg);
  if (!jobId || !Number.isInteger(count) || count < 1) throw new Error(USAGE);

  const job = await db.job.findUnique({
    where: { id: jobId },
    select: { id: true, businessId: true },
  });
  if (!job) throw new Error(`Job ${jobId} not found.`);

  const prefix = fail ? "fail-test" : "test";
  await db.submission.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      jobId: job.id,
      businessId: job.businessId,
      source: "WEB" as const,
      status: "QUEUED" as const,
      originalFilename: `${prefix}-${index + 1}.pdf`,
      sha256: TEST_SHA256,
      fileSizeBytes: 0,
      storageKey: null,
    })),
  });
  console.log(`Queued ${count} test submissions for job ${job.id}.`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
