import "server-only";
import { serverEnv } from "@/lib/env.server";

export function intakeMailbox() {
  return serverEnv.GOOGLE_SYSTEM_ACCOUNT.toLowerCase();
}

export function intakeAddress(emailAlias: string) {
  const mailbox = intakeMailbox();
  const at = mailbox.lastIndexOf("@");
  return `${mailbox.slice(0, at)}+${emailAlias.toLowerCase()}${mailbox.slice(at)}`;
}
