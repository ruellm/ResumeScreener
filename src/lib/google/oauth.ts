import "server-only";
import { serverEnv } from "@/lib/env.server";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/drive",
];

export const GOOGLE_CONNECTION_ID = "system";

export function oauthOptions() {
  return {
    clientId: serverEnv.GOOGLE_CLIENT_ID,
    clientSecret: serverEnv.GOOGLE_CLIENT_SECRET,
    redirectUri: new URL("/api/admin/google/callback", serverEnv.APP_BASE_URL).toString(),
  };
}
