"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { JobStatus } from "@prisma/client";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { requireBusinessUser } from "@/lib/auth";
import { db, isUniqueViolation } from "@/lib/db";
import { logEvent } from "@/lib/events";
import { jobInputSchema } from "@/lib/job-schema";
import { JOB_STATUS_ACTIONS } from "@/lib/job-status";

const updateJobSchema = jobInputSchema.extend({ id: z.string().min(1) });

const setJobStatusSchema = z.object({
  id: z.string().min(1),
  status: z.enum(JobStatus),
});

// No lookalike characters (0/o, 1/l/i).
const ALIAS_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const ALIAS_LENGTH = 8;
const ALIAS_ATTEMPTS = 5;

function generateEmailAlias() {
  let alias = "";
  for (let i = 0; i < ALIAS_LENGTH; i++) {
    alias += ALIAS_ALPHABET[randomInt(ALIAS_ALPHABET.length)];
  }
  return alias;
}

// New selections must be active. A skill already on the job may stay
// after it was deactivated.
async function skillSelectionError(skillIds: string[], attachedIds: Set<string>) {
  if (skillIds.length === 0) return null;

  const skills = await db.skill.findMany({
    where: { id: { in: skillIds } },
    select: { id: true, name: true, isActive: true },
  });
  if (skills.length !== skillIds.length) {
    return "One of the selected skills does not exist.";
  }

  const blocked = skills.find((skill) => !skill.isActive && !attachedIds.has(skill.id));
  if (blocked) {
    return `"${blocked.name}" is no longer available. Remove it and try again.`;
  }
  return null;
}

export async function createJob(input: unknown): Promise<ActionResult> {
  const user = await requireBusinessUser();

  const parsed = jobInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  const { skills, ...fields } = parsed.data;

  const skillError = await skillSelectionError(
    skills.map((skill) => skill.skillId),
    new Set(),
  );
  if (skillError) return { ok: false, error: skillError };

  let jobId: string | undefined;
  for (let attempt = 0; attempt < ALIAS_ATTEMPTS && !jobId; attempt++) {
    try {
      jobId = await db.$transaction(async (tx) => {
        const job = await tx.job.create({
          data: {
            ...fields,
            businessId: user.business.id,
            createdById: user.id,
            emailAlias: generateEmailAlias(),
          },
        });
        await tx.jobSkill.createMany({
          data: skills.map((skill) => ({ jobId: job.id, ...skill })),
        });
        return job.id;
      });
    } catch (error) {
      // Only the alias can collide here, so try again with a new one.
      if (!isUniqueViolation(error)) throw error;
    }
  }
  if (!jobId) return { ok: false, error: "Could not create the job. Try again." };

  await logEvent({
    type: "job.created",
    message: "Job created",
    businessId: user.business.id,
    jobId,
    meta: { actorId: user.id },
  });

  revalidatePath("/app");
  redirect(`/app/jobs/${jobId}`);
}

export async function updateJob(input: unknown): Promise<ActionResult> {
  const user = await requireBusinessUser();

  const parsed = updateJobSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  const { id, skills, ...fields } = parsed.data;

  const job = await db.job.findFirst({
    where: { id, businessId: user.business.id },
    select: { skills: { select: { skillId: true } } },
  });
  if (!job) notFound();

  const skillError = await skillSelectionError(
    skills.map((skill) => skill.skillId),
    new Set(job.skills.map((skill) => skill.skillId)),
  );
  if (skillError) return { ok: false, error: skillError };

  await db.$transaction(async (tx) => {
    await tx.job.update({
      where: { id, businessId: user.business.id },
      data: fields,
    });
    await tx.jobSkill.deleteMany({ where: { jobId: id } });
    await tx.jobSkill.createMany({
      data: skills.map((skill) => ({ jobId: id, ...skill })),
    });
  });

  await logEvent({
    type: "job.updated",
    message: "Job updated",
    businessId: user.business.id,
    jobId: id,
    meta: { actorId: user.id },
  });

  revalidatePath("/app");
  revalidatePath(`/app/jobs/${id}`);
  redirect(`/app/jobs/${id}`);
}

export async function setJobStatus(input: unknown): Promise<ActionResult> {
  const user = await requireBusinessUser();

  const parsed = setJobStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid status change." };
  const { id, status } = parsed.data;

  const job = await db.job.findFirst({
    where: { id, businessId: user.business.id },
    select: { status: true },
  });
  if (!job) notFound();

  if (!JOB_STATUS_ACTIONS[job.status].some((action) => action.to === status)) {
    return { ok: false, error: "This status change is not allowed." };
  }

  await db.job.update({
    where: { id, businessId: user.business.id },
    data: { status },
  });

  await logEvent({
    type: "job.status_changed",
    message: "Job status changed",
    businessId: user.business.id,
    jobId: id,
    meta: { actorId: user.id, from: job.status, to: status },
  });

  revalidatePath("/app");
  revalidatePath(`/app/jobs/${id}`);
  return { ok: true };
}
