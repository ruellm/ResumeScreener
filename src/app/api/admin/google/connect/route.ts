import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth";
import { buildConsentUrl } from "@/lib/google/connect";
import { STATE_COOKIE, stateCookieOptions } from "@/lib/google/state-cookie";

export const dynamic = "force-dynamic";

export async function GET() {
  await requireSuperAdmin();

  const state = randomBytes(32).toString("base64url");
  const response = NextResponse.redirect(buildConsentUrl(state));
  response.cookies.set(STATE_COOKIE, state, stateCookieOptions(600));
  return response;
}
