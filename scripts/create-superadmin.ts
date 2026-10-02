import { z } from "zod";
import { createAccount, createSetPasswordLink } from "@/lib/accounts";
import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env.server";

async function main() {
  const parsed = z.email().safeParse(process.argv[2]);
  if (!parsed.success) {
    throw new Error("Usage: npm run create-superadmin -- someone@example.com");
  }
  const email = parsed.data.toLowerCase();

  const existing = await db.user.findUnique({ where: { email } });
  if (existing && existing.role !== "SUPERADMIN") {
    throw new Error(`${email} already exists and is not a super admin.`);
  }
  if (!existing) {
    await createAccount({ email, name: null, role: "SUPERADMIN", businessId: null });
  }

  console.log(await createSetPasswordLink(email, serverEnv.APP_BASE_URL));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
