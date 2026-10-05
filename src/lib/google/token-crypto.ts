import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { serverEnv } from "@/lib/env.server";

const PREFIX = "v1";

function defaultKey() {
  return Buffer.from(serverEnv.GOOGLE_TOKEN_ENCRYPTION_KEY, "base64");
}

export function encrypt(plain: string, key: Buffer = defaultKey()) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [PREFIX, iv, cipher.getAuthTag(), ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64")))
    .join(":");
}

// Throws when the value was changed or the key is not the one it was encrypted with.
export function decrypt(value: string, key: Buffer = defaultKey()) {
  const [prefix, iv, tag, ciphertext, ...rest] = value.split(":");
  if (prefix !== PREFIX || !iv || !tag || ciphertext === undefined || rest.length > 0) {
    throw new Error("Encrypted token has an unknown format");
  }
  const tagBytes = Buffer.from(tag, "base64");
  // Node would otherwise accept a shortened tag.
  if (tagBytes.length !== 16) throw new Error("Encrypted token has an unknown format");

  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(tagBytes);
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
