import { z } from "zod";

export const JOB_LIMITS = {
  title: 150,
  roleOverview: 4000,
  requirements: 6000,
  idealCandidateProfile: 4000,
  passingCriteria: 3000,
  postUrl: 2000,
  skills: 30,
} as const;

function requiredText(label: string, max: number) {
  return z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be at most ${max} characters.`);
}

function isHttpUrl(value: string) {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export const jobInputSchema = z.object({
  title: requiredText("Title", JOB_LIMITS.title),
  roleOverview: requiredText("Role overview", JOB_LIMITS.roleOverview),
  requirements: requiredText("Requirements", JOB_LIMITS.requirements),
  idealCandidateProfile: requiredText(
    "Ideal candidate profile",
    JOB_LIMITS.idealCandidateProfile,
  ),
  passingCriteria: requiredText("Passing criteria", JOB_LIMITS.passingCriteria),
  skills: z
    .array(z.object({ skillId: z.string().min(1), isRequired: z.boolean() }))
    .max(JOB_LIMITS.skills, `A job can have at most ${JOB_LIMITS.skills} skills.`)
    .refine(
      (skills) => new Set(skills.map((skill) => skill.skillId)).size === skills.length,
      "Each skill can be added only once.",
    ),
  // Empty input means "not set".
  postUrl: z.preprocess(
    (value) =>
      value == null || (typeof value === "string" && value.trim() === "") ? null : value,
    z
      .string()
      .trim()
      .max(JOB_LIMITS.postUrl, `Post URL must be at most ${JOB_LIMITS.postUrl} characters.`)
      .refine(isHttpUrl, "Post URL must start with http:// or https://.")
      .nullable(),
  ),
});

export type JobInput = z.infer<typeof jobInputSchema>;
