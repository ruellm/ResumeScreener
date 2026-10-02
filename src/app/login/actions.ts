"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { homeFor } from "@/lib/auth";
import { db } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export async function login(input: unknown): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Enter your email and password." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    return { ok: false, error: "Invalid email or password." };
  }

  const user = await db.user.findUnique({
    where: { id: data.user.id },
    include: { business: true },
  });
  if (!user || !user.isActive || (user.business && !user.business.isActive)) {
    await supabase.auth.signOut();
    return { ok: false, error: "Account is disabled." };
  }

  await db.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  redirect(homeFor(user.role));
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
