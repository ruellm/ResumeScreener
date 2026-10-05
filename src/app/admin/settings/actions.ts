"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { requireSuperAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { logEvent } from "@/lib/events";
import { disconnect, testConnection, type GoogleTestResult } from "@/lib/google/connect";
import { effectiveRetentionDays, shorteningImpact, type PurgeImpact } from "@/lib/retention";
import { settingsInputSchema } from "@/lib/settings-schema";

// With confirm set, nothing was saved yet: the admin has to confirm first.
export async function updateSettings(
  input: unknown,
): Promise<ActionResult<{ confirm?: PurgeImpact }>> {
  const admin = await requireSuperAdmin();

  const parsed = settingsInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  const { confirmed, ...after } = parsed.data;

  const [settings, businesses] = await Promise.all([
    db.settings.findUniqueOrThrow({ where: { id: 1 } }),
    db.business.findMany({ select: { id: true, retentionDays: true } }),
  ]);
  const before = {
    defaultRetentionDays: settings.defaultRetentionDays,
    minRetentionDays: settings.minRetentionDays,
    maxRetentionDays: settings.maxRetentionDays,
    maxFileSizeMb: settings.maxFileSizeMb,
  };
  const keys = Object.keys(before) as (keyof typeof before)[];
  if (keys.every((key) => before[key] === after[key])) return { ok: true };

  if (!confirmed) {
    const impact = await shorteningImpact(
      businesses.map((business) => ({
        businessId: business.id,
        before: effectiveRetentionDays(business, before),
        after: effectiveRetentionDays(business, after),
      })),
    );
    if (impact) return { ok: true, confirm: impact };
  }

  await db.settings.update({ where: { id: 1 }, data: after });

  await logEvent({
    type: "settings.updated",
    message: "Settings updated",
    meta: { actorId: admin.id, before, after },
  });

  revalidatePath("/admin/settings");
  return { ok: true };
}

export async function disconnectGoogle(): Promise<ActionResult> {
  const admin = await requireSuperAdmin();

  await disconnect(admin.id);

  revalidatePath("/admin/settings");
  return { ok: true };
}

export async function testGoogleConnection(): Promise<ActionResult<{ result: GoogleTestResult }>> {
  await requireSuperAdmin();

  try {
    return { ok: true, result: await testConnection() };
  } catch (error) {
    // A rejected token has just been recorded on the row.
    revalidatePath("/admin/settings");
    return { ok: false, error: error instanceof Error ? error.message : "The test failed." };
  }
}
