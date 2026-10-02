import { db } from "@/lib/db";
import { purge } from "@/worker/purge";

// Runs the retention purge once, whether or not it is due.
//   npm run purge -- [--dry-run]

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  // Stamped first, so a worker that checks during this run does not start its own.
  if (!dryRun) await db.$executeRaw`UPDATE "Settings" SET "lastPurgeAt" = now() WHERE id = 1`;
  const report = await purge({ dryRun });

  console.log(dryRun ? "Dry run. Nothing was deleted." : "Purge done.");
  for (const business of report.businesses) {
    console.log(
      `${business.name} (${business.businessId}), retention ${business.retentionDays} days: ` +
        `${business.submissions} ${dryRun ? "to delete" : "deleted"}` +
        (business.skipped > 0 ? `, ${business.skipped} kept because a file was not removed` : ""),
    );
  }
  console.log(`Old event log rows: ${report.events} ${dryRun ? "to delete" : "deleted"}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
