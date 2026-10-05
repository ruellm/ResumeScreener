import "server-only";
import { z } from "zod";

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  DIRECT_URL: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  APP_BASE_URL: z
    .string()
    .optional()
    .transform((value) => value || "http://localhost:3000")
    .pipe(z.url()),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_SYSTEM_ACCOUNT: z.string().min(1),
  GOOGLE_TOKEN_ENCRYPTION_KEY: z
    .string()
    .refine(
      (value) =>
        /^[A-Za-z0-9+/]+={0,2}$/.test(value) && Buffer.from(value, "base64").length === 32,
      "must be base64 that decodes to exactly 32 bytes",
    ),
});

export const serverEnv = serverSchema.parse(process.env);
