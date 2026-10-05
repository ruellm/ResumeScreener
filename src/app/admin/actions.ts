"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createAccount, createSetPasswordLink } from "@/lib/accounts";
import type { ActionResult } from "@/lib/action-result";
import { requireSuperAdmin } from "@/lib/auth";
import { db, isUniqueViolation } from "@/lib/db";
import { serverEnv } from "@/lib/env.server";
import { logEvent } from "@/lib/events";
import { syncBusinessFolder } from "@/lib/google/drive-folders";
import { effectiveRetentionDays, shorteningImpact, type PurgeImpact } from "@/lib/retention";

// Empty input means "not set".
const optionalInt = z.preprocess(
  (value) => (value === "" || value == null ? null : value),
  z.coerce.number().int().min(1).nullable(),
);

const createBusinessSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(100),
  slug: z
    .string()
    .trim()
    .max(60)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Slug can use lowercase letters, numbers and single dashes.",
    ),
});

const updateBusinessSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, "Name is required.").max(100),
  isActive: z.boolean(),
  retentionDays: optionalInt,
  monthlyEvalLimit: optionalInt,
  storageLimitMb: optionalInt,
  // Set once the admin has seen what a shorter retention deletes.
  confirmed: z.boolean().default(false),
});

const addUserSchema = z.object({
  businessId: z.string().min(1),
  email: z.email("Enter a valid email.").transform((value) => value.toLowerCase()),
  name: z.string().trim().min(1, "Name is required.").max(100),
});

const userIdSchema = z.object({ userId: z.uuid() });

const setUserActiveSchema = z.object({
  userId: z.uuid(),
  isActive: z.boolean(),
});

const SLUG_TAKEN = "This slug is already taken.";

async function requestOrigin() {
  return (await headers()).get("origin") ?? serverEnv.APP_BASE_URL;
}

export async function createBusiness(input: unknown): Promise<ActionResult> {
  const admin = await requireSuperAdmin();

  const parsed = createBusinessSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const taken = await db.business.findUnique({
    where: { slug: parsed.data.slug },
  });
  if (taken) return { ok: false, error: SLUG_TAKEN };

  let businessId: string;
  try {
    const business = await db.business.create({ data: parsed.data });
    businessId = business.id;
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: SLUG_TAKEN };
    throw error;
  }

  await logEvent({
    type: "business.created",
    message: "Business created",
    businessId,
    meta: { actorId: admin.id },
  });

  revalidatePath("/admin");
  redirect(`/admin/businesses/${businessId}`);
}

// With confirm set, nothing was saved yet: the admin has to confirm first.
export async function updateBusiness(
  input: unknown,
): Promise<ActionResult<{ confirm?: PurgeImpact }>> {
  const admin = await requireSuperAdmin();

  const parsed = updateBusinessSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  const { id, confirmed, ...data } = parsed.data;

  const settings = await db.settings.findUniqueOrThrow({ where: { id: 1 } });
  if (data.retentionDays !== null) {
    const { minRetentionDays, maxRetentionDays } = settings;
    if (
      data.retentionDays < minRetentionDays ||
      data.retentionDays > maxRetentionDays
    ) {
      return {
        ok: false,
        error: `Retention must be between ${minRetentionDays} and ${maxRetentionDays} days.`,
      };
    }
  }

  const existing = await db.business.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: "Business not found." };

  if (!confirmed) {
    const impact = await shorteningImpact([
      {
        businessId: id,
        before: effectiveRetentionDays(existing, settings),
        after: effectiveRetentionDays(data, settings),
      },
    ]);
    if (impact) return { ok: true, confirm: impact };
  }

  await db.business.update({ where: { id }, data });
  if (data.name !== existing.name) await syncBusinessFolder(id);

  await logEvent({
    type: "business.updated",
    message: "Business updated",
    businessId: id,
    meta: { actorId: admin.id },
  });

  revalidatePath("/admin");
  revalidatePath(`/admin/businesses/${id}`);
  return { ok: true };
}

export async function addBusinessUser(
  input: unknown,
): Promise<ActionResult<{ link: string }>> {
  const admin = await requireSuperAdmin();

  const parsed = addUserSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  const { businessId, email, name } = parsed.data;

  const business = await db.business.findUnique({ where: { id: businessId } });
  if (!business) return { ok: false, error: "Business not found." };

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return { ok: false, error: "A user with this email already exists." };
  }

  let userId: string;
  try {
    const user = await createAccount({ email, name, role: "BUSINESS", businessId });
    userId = user.id;
  } catch (error) {
    console.error("addBusinessUser failed", error);
    return { ok: false, error: "Could not create the user." };
  }

  await logEvent({
    type: "user.created",
    message: "User created",
    businessId,
    meta: { actorId: admin.id, userId },
  });
  revalidatePath(`/admin/businesses/${businessId}`);

  let link: string;
  try {
    link = await createSetPasswordLink(email, await requestOrigin());
  } catch (error) {
    console.error("createSetPasswordLink failed", error);
    return {
      ok: false,
      error:
        'User created, but the link could not be generated. Use "New set-password link".',
    };
  }

  await logEvent({
    type: "set_password_link.generated",
    message: "Set-password link generated",
    businessId,
    meta: { actorId: admin.id, userId },
  });

  return { ok: true, link };
}

export async function newSetPasswordLink(
  input: unknown,
): Promise<ActionResult<{ link: string }>> {
  const admin = await requireSuperAdmin();

  const parsed = userIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid user." };

  const user = await db.user.findFirst({
    where: { id: parsed.data.userId, role: "BUSINESS" },
  });
  if (!user) return { ok: false, error: "User not found." };

  let link: string;
  try {
    link = await createSetPasswordLink(user.email, await requestOrigin());
  } catch (error) {
    console.error("createSetPasswordLink failed", error);
    return { ok: false, error: "Could not generate the link." };
  }

  await logEvent({
    type: "set_password_link.generated",
    message: "Set-password link generated",
    businessId: user.businessId ?? undefined,
    meta: { actorId: admin.id, userId: user.id },
  });

  return { ok: true, link };
}

export async function setUserActive(input: unknown): Promise<ActionResult> {
  const admin = await requireSuperAdmin();

  const parsed = setUserActiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid user." };
  const { userId, isActive } = parsed.data;

  const user = await db.user.findFirst({
    where: { id: userId, role: "BUSINESS" },
  });
  if (!user) return { ok: false, error: "User not found." };

  await db.user.update({ where: { id: userId }, data: { isActive } });

  await logEvent({
    type: isActive ? "user.activated" : "user.deactivated",
    message: isActive ? "User activated" : "User deactivated",
    businessId: user.businessId ?? undefined,
    meta: { actorId: admin.id, userId },
  });

  revalidatePath(`/admin/businesses/${user.businessId}`);
  return { ok: true };
}
