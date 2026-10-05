"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { requireBusinessUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logEvent } from "@/lib/events";
import { addSender } from "@/lib/senders";

const addSchema = z.object({ entry: z.string().trim().min(1).max(320) });
const removeSchema = z.object({ id: z.string().min(1) });

// The worker then brings the Drive folder's sharing in line with the list.
function flagDriveSync(businessId: string) {
  return db.business.update({ where: { id: businessId }, data: { driveSyncNeeded: true } });
}

export async function addAllowedSender(input: unknown): Promise<ActionResult> {
  const user = await requireBusinessUser();

  const parsed = addSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Enter an email address or a domain." };
  }

  const result = await addSender(user.business.id, user.id, parsed.data.entry);
  if (!result.ok) return result;

  const { kind, value } = result.sender;
  await flagDriveSync(user.business.id);
  await logEvent({
    type: "sender.added",
    message: `Allowed sender added: ${value}`,
    businessId: user.business.id,
    meta: { actorId: user.id, kind, value },
  });

  revalidatePath("/app/settings");
  return { ok: true };
}

export async function removeAllowedSender(input: unknown): Promise<ActionResult> {
  const user = await requireBusinessUser();

  const parsed = removeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  // An entry of another business is treated the same as one that is gone.
  const sender = await db.allowedSender.findFirst({
    where: { id: parsed.data.id, businessId: user.business.id },
  });
  if (!sender) return { ok: false, error: "That sender is no longer on the list." };

  await db.allowedSender.delete({ where: { id: sender.id } });
  await flagDriveSync(user.business.id);
  await logEvent({
    type: "sender.removed",
    message: `Allowed sender removed: ${sender.value}`,
    businessId: user.business.id,
    meta: { actorId: user.id, kind: sender.kind, value: sender.value },
  });

  revalidatePath("/app/settings");
  return { ok: true };
}
