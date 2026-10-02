import "server-only";
import { randomBytes } from "node:crypto";
import type { UserRole } from "@prisma/client";
import { db } from "@/lib/db";
import { supabaseAdmin } from "@/lib/supabase/admin";

type NewAccount = {
  email: string;
  name: string | null;
  role: UserRole;
  businessId: string | null;
};

export async function createAccount({ email, name, role, businessId }: NewAccount) {
  // Nobody sees this password. The user picks their own through the link.
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    email_confirm: true,
    password: randomBytes(32).toString("base64url"),
  });
  if (error) throw error;

  try {
    return await db.user.create({
      data: { id: data.user.id, email, name, role, businessId },
    });
  } catch (insertError) {
    await supabaseAdmin.auth.admin.deleteUser(data.user.id);
    throw insertError;
  }
}

export async function createSetPasswordLink(email: string, origin: string) {
  const { data, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "recovery",
    email,
  });
  if (error) throw error;

  const url = new URL("/auth/confirm", origin);
  url.searchParams.set("token_hash", data.properties.hashed_token);
  url.searchParams.set("type", "recovery");
  return url.toString();
}
