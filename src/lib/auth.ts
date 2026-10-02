import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { UserRole } from "@prisma/client";
import { db } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";

export function homeFor(role: UserRole) {
  return role === "SUPERADMIN" ? "/admin" : "/app";
}

export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user: authUser },
  } = await supabase.auth.getUser();
  if (!authUser) return null;

  const user = await db.user.findUnique({
    where: { id: authUser.id },
    include: { business: true },
  });
  if (!user || !user.isActive) return null;
  if (user.business && !user.business.isActive) return null;

  return user;
});

export async function requireSuperAdmin() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "SUPERADMIN") redirect("/app");
  return user;
}

export async function requireBusinessUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "BUSINESS") redirect("/admin");
  // A business user without a business is a broken account.
  if (!user.business) redirect("/login");
  return { ...user, business: user.business };
}
