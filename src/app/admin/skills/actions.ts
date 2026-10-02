"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { requireSuperAdmin } from "@/lib/auth";
import { db, isUniqueViolation } from "@/lib/db";
import { logEvent } from "@/lib/events";

const skillName = z
  .string()
  .trim()
  .min(1, "Name is required.")
  .max(100, "Name must be at most 100 characters.");

const addSkillSchema = z.object({
  name: skillName,
  category: z
    .string()
    .trim()
    .min(1, "Category is required.")
    .max(60, "Category must be at most 60 characters."),
});

const renameSkillSchema = z.object({
  id: z.string().min(1),
  name: skillName,
});

const setSkillActiveSchema = z.object({
  id: z.string().min(1),
  isActive: z.boolean(),
});

const NAME_TAKEN = "A skill with this name already exists.";

// The database constraint is case sensitive, so "react" would slip past "React".
async function nameTaken(name: string, exceptId?: string) {
  const existing = await db.skill.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      ...(exceptId && { id: { not: exceptId } }),
    },
    select: { id: true },
  });
  return existing !== null;
}

export async function addSkill(input: unknown): Promise<ActionResult> {
  const admin = await requireSuperAdmin();

  const parsed = addSkillSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  const { name } = parsed.data;

  if (await nameTaken(name)) return { ok: false, error: NAME_TAKEN };

  // Reuse the spelling of a category that already exists.
  const sameCategory = await db.skill.findFirst({
    where: { category: { equals: parsed.data.category, mode: "insensitive" } },
    select: { category: true },
  });
  const category = sameCategory?.category ?? parsed.data.category;

  let skillId: string;
  try {
    const skill = await db.skill.create({ data: { name, category } });
    skillId = skill.id;
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: NAME_TAKEN };
    throw error;
  }

  await logEvent({
    type: "skill.created",
    message: "Skill created",
    meta: { actorId: admin.id, skillId, name, category },
  });

  revalidatePath("/admin/skills");
  return { ok: true };
}

export async function renameSkill(input: unknown): Promise<ActionResult> {
  const admin = await requireSuperAdmin();

  const parsed = renameSkillSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  const { id, name } = parsed.data;

  const skill = await db.skill.findUnique({ where: { id } });
  if (!skill) return { ok: false, error: "Skill not found." };
  if (skill.name === name) return { ok: true };

  if (await nameTaken(name, id)) return { ok: false, error: NAME_TAKEN };

  try {
    await db.skill.update({ where: { id }, data: { name } });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: NAME_TAKEN };
    throw error;
  }

  await logEvent({
    type: "skill.renamed",
    message: "Skill renamed",
    meta: { actorId: admin.id, skillId: id, from: skill.name, to: name },
  });

  revalidatePath("/admin/skills");
  return { ok: true };
}

export async function setSkillActive(input: unknown): Promise<ActionResult> {
  const admin = await requireSuperAdmin();

  const parsed = setSkillActiveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid skill." };
  const { id, isActive } = parsed.data;

  const skill = await db.skill.findUnique({ where: { id } });
  if (!skill) return { ok: false, error: "Skill not found." };
  if (skill.isActive === isActive) return { ok: true };

  await db.skill.update({ where: { id }, data: { isActive } });

  await logEvent({
    type: isActive ? "skill.activated" : "skill.deactivated",
    message: isActive ? "Skill activated" : "Skill deactivated",
    meta: { actorId: admin.id, skillId: id, name: skill.name },
  });

  revalidatePath("/admin/skills");
  return { ok: true };
}
