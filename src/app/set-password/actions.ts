"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { getCurrentUser, homeFor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const passwordSchema = z
  .object({
    password: z.string().min(10, "Password must be at least 10 characters."),
    confirm: z.string(),
  })
  .refine((value) => value.password === value.confirm, {
    message: "Passwords do not match.",
  });

export async function setPassword(input: unknown): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const parsed = passwordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) {
    return { ok: false, error: error.message };
  }

  redirect(homeFor(user.role));
}
