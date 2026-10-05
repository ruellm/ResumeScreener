import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireSuperAdmin } from "@/lib/auth";
import { serverEnv } from "@/lib/env.server";
import { completeConnect, GoogleConnectError } from "@/lib/google/connect";
import { STATE_COOKIE, stateCookieOptions } from "@/lib/google/state-cookie";

export const dynamic = "force-dynamic";

function sameState(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function connect(request: NextRequest, actorId: string) {
  const params = request.nextUrl.searchParams;
  const state = params.get("state");
  const expected = request.cookies.get(STATE_COOKIE)?.value;
  if (!state || !expected || !sameState(state, expected)) {
    throw new GoogleConnectError("The sign-in could not be verified. Start the connection again.");
  }

  if (params.get("error") === "access_denied") {
    throw new GoogleConnectError("Access was not granted at Google.");
  }
  const code = params.get("code");
  if (!code) throw new GoogleConnectError("Google did not return a sign-in code.");

  return completeConnect(code, actorId);
}

export async function GET(request: NextRequest) {
  const admin = await requireSuperAdmin();

  const target = new URL("/admin/settings", serverEnv.APP_BASE_URL);
  try {
    const { email } = await connect(request, admin.id);
    target.searchParams.set("google", `Connected ${email}.`);
  } catch (error) {
    if (!(error instanceof GoogleConnectError)) {
      console.error("Google connect failed:", error instanceof Error ? error.message : error);
    }
    target.searchParams.set(
      "googleError",
      error instanceof GoogleConnectError
        ? error.message
        : "Could not complete the Google connection. Try again.",
    );
  }

  const response = NextResponse.redirect(target);
  response.cookies.set(STATE_COOKIE, "", stateCookieOptions(0));
  return response;
}
