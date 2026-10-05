import "server-only";
import { Auth } from "googleapis";
import { db } from "@/lib/db";
import { logEvent } from "@/lib/events";
import { GOOGLE_CONNECTION_ID, oauthOptions } from "./oauth";
import { decrypt } from "./token-crypto";

const LAST_USED_INTERVAL_MS = 60_000;

export class GoogleNotConnectedError extends Error {
  constructor(message = "The Google account is not connected.") {
    super(message);
    this.name = "GoogleNotConnectedError";
  }
}

// Google answers invalid_grant when the refresh token was revoked or has expired.
function invalidGrantReason(error: unknown) {
  const data = (error as { response?: { data?: unknown } })?.response?.data;
  if (typeof data !== "object" || data === null) return null;
  const { error: code, error_description: description } = data as Record<string, unknown>;
  if (code !== "invalid_grant") return null;
  return typeof description === "string" && description ? description : "invalid_grant";
}

async function markInvalid(encryptedRefreshToken: string, reason: string) {
  const lastError = `Google rejected the stored token: ${reason}`;
  // Matching on the token leaves a reconnect that happened meanwhile alone.
  const { count } = await db.googleConnection.updateMany({
    where: { id: GOOGLE_CONNECTION_ID, encryptedRefreshToken, status: "ok" },
    data: { status: "error", lastError },
  });
  if (count === 0) return;
  await logEvent({
    type: "google.token_invalid",
    message: lastError,
  });
}

class SystemOAuth2Client extends Auth.OAuth2Client {
  constructor(private readonly encryptedRefreshToken: string) {
    // A token revoked while the access token is still cached shows up as a 401.
    super({ ...oauthOptions(), forceRefreshOnFailure: true });
    this.setCredentials({ refresh_token: decrypt(encryptedRefreshToken) });
  }

  // Every call that needs a fresh access token goes through here.
  protected async refreshTokenNoCache(refreshToken?: string | null) {
    try {
      return await super.refreshTokenNoCache(refreshToken);
    } catch (error) {
      const reason = invalidGrantReason(error);
      if (!reason) throw error;
      await markInvalid(this.encryptedRefreshToken, reason);
      throw new GoogleNotConnectedError(
        "Google rejected the stored token. Reconnect the Google account.",
      );
    }
  }
}

// Kept so the access token is reused while the stored token stays the same.
let cached: SystemOAuth2Client | undefined;
let cachedFor: string | undefined;

export async function getSystemAuth(): Promise<Auth.OAuth2Client> {
  const row = await db.googleConnection.findUnique({ where: { id: GOOGLE_CONNECTION_ID } });
  if (!row) throw new GoogleNotConnectedError();
  if (row.status !== "ok") {
    throw new GoogleNotConnectedError("The Google account needs to be reconnected.");
  }

  if (!cached || cachedFor !== row.encryptedRefreshToken) {
    cached = new SystemOAuth2Client(row.encryptedRefreshToken);
    cachedFor = row.encryptedRefreshToken;
  }

  const now = Date.now();
  if (!row.lastUsedAt || now - row.lastUsedAt.getTime() >= LAST_USED_INTERVAL_MS) {
    await db.googleConnection.updateMany({
      where: { id: GOOGLE_CONNECTION_ID },
      data: { lastUsedAt: new Date(now) },
    });
  }

  return cached;
}
