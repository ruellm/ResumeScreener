import "server-only";
import { serverEnv } from "@/lib/env.server";

export const STATE_COOKIE = "google_oauth_state";

export function stateCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: serverEnv.APP_BASE_URL.startsWith("https://"),
    path: "/api/admin/google",
    maxAge,
  };
}
