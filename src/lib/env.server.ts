import "server-only";
import { z } from "zod";

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1),
  WORKER_DATABASE_URL: z
    .string()
    .optional()
    .transform((value) => value || undefined),
  ANTHROPIC_API_KEY: z.string().min(1),
  APP_BASE_URL: z
    .string()
    .optional()
    .transform((value) => value || "http://localhost:3000")
    .pipe(z.url()),
});

export const serverEnv = serverSchema.parse(process.env);
