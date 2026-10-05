import { db } from "@/lib/db";
import { ROOT_FOLDER_NAME, jobFolderName } from "@/lib/google/drive-folders";
import type { DriveClient } from "@/lib/google/drive";
import { GoogleNotConnectedError } from "@/lib/google/system-auth";
import { log } from "../config";
import { removePermission, syncBusinessSharing } from "./sharing";

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

// Takes the hourly audit if it is due. One statement, so two workers checking
// at the same moment cannot both get it.
export async function claimAudit() {
  const rows = await db.$queryRaw<{ id: number }[]>`
    UPDATE "Settings"
    SET "driveLastAuditAt" = now()
    WHERE id = 1
      AND ("driveLastAuditAt" IS NULL OR "driveLastAuditAt" < now() - interval '1 hour')
    RETURNING id`;
  return rows.length > 0;
}

// One folder failing must not stop the rest.
async function each<T extends { id: string }>(items: T[], what: string, check: (item: T) => Promise<void>) {
  for (const item of items) {
    try {
      await check(item);
    } catch (error) {
      if (error instanceof GoogleNotConnectedError) throw error;
      log(`drive audit: ${what} ${item.id} not checked: ${describe(error)}`);
    }
  }
}

async function fixName(drive: DriveClient, folderId: string, name: string) {
  const folder = await drive.getFile(folderId);
  if (folder.name !== name) await drive.rename(folderId, name);
}

// Puts the sharing of every folder back to what it should be: nobody on the
// root, the allowed senders on each business folder, nothing extra on a job
// folder. businessIds limits the run to those businesses. Returns how many
// permissions were removed.
export async function auditDrive(
  drive: DriveClient,
  rootId: string,
  { businessIds }: { businessIds?: string[] } = {},
) {
  const scope = businessIds && { in: businessIds };
  let removed = 0;

  for (const permission of await drive.listPermissions(rootId)) {
    if (permission.role === "owner") continue;
    await removePermission(
      drive,
      { id: rootId, name: ROOT_FOLDER_NAME },
      permission,
      "drive.permission_fixed",
    );
    removed += 1;
  }

  const businesses = await db.business.findMany({
    where: { id: scope, driveFolderId: { not: null } },
    select: { id: true, name: true, driveFolderId: true },
  });
  // What a job folder may carry: the access it gets from its business folder.
  const inheritable = new Map<string, Set<string>>();

  await each(businesses, "business", async (business) => {
    const folderId = business.driveFolderId!;
    await fixName(drive, folderId, business.name);

    const before = await drive.listPermissions(folderId);
    await syncBusinessSharing(drive, business, { audit: true });
    const after = await drive.listPermissions(folderId);
    removed += before.filter((old) => !after.some((now) => now.id === old.id)).length;
    inheritable.set(business.id, new Set(after.map((permission) => permission.id)));
  });

  const jobs = await db.job.findMany({
    where: { businessId: scope, driveFolderId: { not: null } },
    select: { id: true, title: true, emailAlias: true, businessId: true, driveFolderId: true },
  });
  await each(jobs, "job", async (job) => {
    const fromBusiness = inheritable.get(job.businessId);
    if (!fromBusiness) return;
    const folderId = job.driveFolderId!;
    const name = jobFolderName(job);
    await fixName(drive, folderId, name);

    for (const permission of await drive.listPermissions(folderId)) {
      // Google does not always say whether access is inherited. Then anything
      // the business folder does not have was added here.
      const inherited = permission.inherited ?? fromBusiness.has(permission.id);
      if (permission.role === "owner" || inherited) continue;
      await removePermission(
        drive,
        { id: folderId, name, businessId: job.businessId, jobId: job.id },
        permission,
        "drive.permission_fixed",
      );
      removed += 1;
    }
  });

  return removed;
}
