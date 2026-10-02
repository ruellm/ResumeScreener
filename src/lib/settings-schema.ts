import { z } from "zod";

export const SETTINGS_LIMITS = {
  retentionDaysMin: 30,
  retentionDaysMax: 730,
  // The storage buckets refuse anything larger.
  fileSizeMbMax: 10,
} as const;

function wholeNumber(label: string) {
  const message = `${label} must be a whole number.`;
  return z.preprocess(
    (value) => (value === "" || value == null ? undefined : value),
    z.coerce.number({ error: message }).int(message),
  );
}

const { retentionDaysMin, retentionDaysMax, fileSizeMbMax } = SETTINGS_LIMITS;

export const settingsInputSchema = z
  .object({
    defaultRetentionDays: wholeNumber("Default retention"),
    minRetentionDays: wholeNumber("Minimum retention"),
    maxRetentionDays: wholeNumber("Maximum retention"),
    maxFileSizeMb: wholeNumber("Maximum file size"),
    // Set once the admin has seen what a shorter retention deletes.
    confirmed: z.boolean().default(false),
  })
  .refine((value) => value.minRetentionDays >= retentionDaysMin, {
    error: `Minimum retention must be at least ${retentionDaysMin} days.`,
  })
  .refine((value) => value.maxRetentionDays <= retentionDaysMax, {
    error: `Maximum retention must be at most ${retentionDaysMax} days.`,
  })
  .refine((value) => value.minRetentionDays <= value.maxRetentionDays, {
    error: "Minimum retention cannot be more than the maximum.",
  })
  .refine(
    (value) =>
      value.defaultRetentionDays >= value.minRetentionDays &&
      value.defaultRetentionDays <= value.maxRetentionDays,
    { error: "Default retention must be between the minimum and the maximum." },
  )
  .refine((value) => value.maxFileSizeMb >= 1 && value.maxFileSizeMb <= fileSizeMbMax, {
    error: `Maximum file size must be between 1 and ${fileSizeMbMax} MB.`,
  });
