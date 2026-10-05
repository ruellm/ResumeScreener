import "server-only";
import { Auth, google } from "googleapis";
import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env.server";
import { logEvent } from "@/lib/events";
import { normalizeGmail } from "./normalize-gmail";
import { GOOGLE_CONNECTION_ID, GOOGLE_SCOPES, oauthOptions } from "./oauth";
import { getSystemAuth } from "./system-auth";
import { decrypt, encrypt } from "./token-crypto";

// The message is safe to show to the admin.
export class GoogleConnectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleConnectError";
  }
}

export function buildConsentUrl(state: string) {
  return new Auth.OAuth2Client(oauthOptions()).generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    login_hint: serverEnv.GOOGLE_SYSTEM_ACCOUNT,
    scope: GOOGLE_SCOPES,
    state,
  });
}

export async function completeConnect(code: string, actorId: string) {
  const client = new Auth.OAuth2Client(oauthOptions());
  const { tokens } = await client.getToken(code);

  if (!tokens.refresh_token) {
    throw new GoogleConnectError("Google did not return a refresh token. Try connecting again.");
  }
  const granted = (tokens.scope ?? "").split(" ");
  if (!GOOGLE_SCOPES.every((scope) => granted.includes(scope))) {
    throw new GoogleConnectError(
      "Not all permissions were granted. Connect again and allow Gmail and Drive access.",
    );
  }

  client.setCredentials(tokens);
  const profile = await google.gmail({ version: "v1", auth: client }).users.getProfile({
    userId: "me",
  });
  const address = profile.data.emailAddress ?? "";

  if (normalizeGmail(address) !== normalizeGmail(serverEnv.GOOGLE_SYSTEM_ACCOUNT)) {
    await client.revokeToken(tokens.refresh_token).catch(() => undefined);
    throw new GoogleConnectError(
      `Connect ${serverEnv.GOOGLE_SYSTEM_ACCOUNT} (the configured account), not ${address}.`,
    );
  }

  const data = {
    email: address,
    encryptedRefreshToken: encrypt(tokens.refresh_token),
    scopes: tokens.scope ?? "",
    status: "ok",
    lastError: null,
    connectedAt: new Date(),
    connectedById: actorId,
    lastUsedAt: null,
  };
  await db.googleConnection.upsert({
    where: { id: GOOGLE_CONNECTION_ID },
    create: { id: GOOGLE_CONNECTION_ID, ...data },
    update: data,
  });
  await logEvent({
    type: "google.connected",
    message: `Google account connected: ${address}`,
    meta: { actorId, email: address },
  });

  return { email: address };
}

export async function disconnect(actorId: string) {
  const row = await db.googleConnection.findUnique({ where: { id: GOOGLE_CONNECTION_ID } });
  if (!row) return;

  try {
    const client = new Auth.OAuth2Client(oauthOptions());
    await client.revokeToken(decrypt(row.encryptedRefreshToken));
  } catch {
    // The row goes either way. A token Google no longer knows cannot be revoked.
  }

  await db.googleConnection.delete({ where: { id: GOOGLE_CONNECTION_ID } });
  await logEvent({
    type: "google.disconnected",
    message: `Google account disconnected: ${row.email}`,
    meta: { actorId, email: row.email },
  });
}

export type GoogleTestResult = {
  gmail: { address: string; messagesTotal: number };
  drive: { email: string; storageUsedBytes: number; storageLimitBytes: number | null };
};

export async function testConnection(): Promise<GoogleTestResult> {
  const auth = await getSystemAuth();
  const [profile, about] = await Promise.all([
    google.gmail({ version: "v1", auth }).users.getProfile({ userId: "me" }),
    google.drive({ version: "v3", auth }).about.get({
      fields: "user(emailAddress),storageQuota(usage,limit)",
    }),
  ]);

  const quota = about.data.storageQuota;
  return {
    gmail: {
      address: profile.data.emailAddress ?? "",
      messagesTotal: profile.data.messagesTotal ?? 0,
    },
    drive: {
      email: about.data.user?.emailAddress ?? "",
      storageUsedBytes: Number(quota?.usage ?? 0),
      // Google leaves the limit out for unlimited storage.
      storageLimitBytes: quota?.limit ? Number(quota.limit) : null,
    },
  };
}
