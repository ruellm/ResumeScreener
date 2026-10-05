import { db } from "@/lib/db";
import { logEvent } from "@/lib/events";
import { DriveApiError, type DriveClient, type DrivePermission } from "@/lib/google/drive";
import { normalizeGmail } from "@/lib/google/normalize-gmail";
import { GoogleNotConnectedError } from "@/lib/google/system-auth";
import { log } from "../config";

type BusinessRef = { id: string; name: string; driveFolderId: string | null };

export function sharingMessage(businessName: string) {
  return `You can upload PDF resumes for ${businessName} here. Results appear next to each file.`;
}

export function granteeOf(permission: DrivePermission) {
  if (permission.type === "anyone") return "anyone with the link";
  return permission.emailAddress ?? permission.domain ?? permission.id;
}

// Google refuses to share a folder for editing with an address that has no Google account.
function isNotGoogleAccount(error: unknown) {
  return (
    error instanceof DriveApiError &&
    error.status === 400 &&
    (error.reason === "invalidSharingRequest" || /no google account/i.test(error.message))
  );
}

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

// Removes a permission that should not be there and records it.
export async function removePermission(
  drive: DriveClient,
  folder: { id: string; name: string; businessId?: string; jobId?: string },
  permission: DrivePermission,
  eventType: "drive.permission_fixed" | "drive.permission_removed",
) {
  await drive.deletePermission(folder.id, permission.id);
  await logEvent({
    type: eventType,
    message: `Drive access removed: ${granteeOf(permission)} on ${folder.name}`,
    businessId: folder.businessId,
    jobId: folder.jobId,
    meta: {
      folderId: folder.id,
      folder: folder.name,
      grantee: granteeOf(permission),
      type: permission.type,
      role: permission.role,
    },
  });
}

// Makes the business folder's sharing match the allowed senders: every email
// entry can edit, nobody else can. Domain entries are never shared. In an
// audit, a removal counts as a fix; otherwise it follows a sender being removed.
export async function syncBusinessSharing(
  drive: DriveClient,
  business: BusinessRef,
  { audit }: { audit: boolean },
) {
  if (!business.driveFolderId) return;
  const folderId = business.driveFolderId;

  const [senders, permissions] = await Promise.all([
    db.allowedSender.findMany({ where: { businessId: business.id, kind: "email" } }),
    drive.listPermissions(folderId),
  ]);
  const owner = permissions.find((permission) => permission.role === "owner");
  const ownerAddress = owner?.emailAddress ? normalizeGmail(owner.emailAddress) : null;
  const kept = new Set<string>();

  for (const sender of senders) {
    const save = (data: {
      driveStatus: string;
      drivePermissionId?: string | null;
      driveError?: string | null;
    }) =>
      db.allowedSender.updateMany({
        where: { id: sender.id },
        data: { drivePermissionId: null, driveError: null, ...data },
      });

    const existing = permissions.find(
      (permission) =>
        permission.type === "user" &&
        permission.role !== "owner" &&
        (permission.id === sender.drivePermissionId ||
          (permission.emailAddress !== null &&
            normalizeGmail(permission.emailAddress) === sender.value)),
    );
    if (existing) {
      kept.add(existing.id);
      if (sender.driveStatus !== "shared" || sender.drivePermissionId !== existing.id) {
        await save({ driveStatus: "shared", drivePermissionId: existing.id });
      }
      continue;
    }
    // The owner already has full access.
    if (sender.value === ownerAddress) {
      if (sender.driveStatus !== "shared") await save({ driveStatus: "shared" });
      continue;
    }

    try {
      const permissionId = await drive.shareWithUser(
        folderId,
        sender.value,
        sharingMessage(business.name),
      );
      kept.add(permissionId);
      await save({ driveStatus: "shared", drivePermissionId: permissionId });
    } catch (error) {
      if (error instanceof GoogleNotConnectedError) throw error;
      if (isNotGoogleAccount(error)) {
        await save({ driveStatus: "needs_google_account" });
      } else {
        log(`drive: ${business.name} not shared with a sender: ${describe(error)}`);
        await save({ driveStatus: "error", driveError: describe(error).slice(0, 300) });
      }
    }
  }

  for (const permission of permissions) {
    // Access that comes from the root folder is taken away there.
    if (permission.role === "owner" || kept.has(permission.id) || permission.inherited) continue;
    await removePermission(
      drive,
      { id: folderId, name: business.name, businessId: business.id },
      permission,
      audit ? "drive.permission_fixed" : "drive.permission_removed",
    );
  }
}
