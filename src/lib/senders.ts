import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { db, isUniqueViolation } from "@/lib/db";
import { normalizeGmail } from "@/lib/google/normalize-gmail";
import { PUBLIC_EMAIL_DOMAINS } from "@/lib/public-email-domains";

export const MAX_SENDERS = 50;

export type SenderKind = "email" | "domain";

export type ParsedSender = { kind: SenderKind; value: string; display: string };

const DOMAIN_LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const emailSchema = z.email().max(254);

function parseDomain(display: string): ActionResult<{ sender: ParsedSender }> {
  const value = display.replace(/^@/, "").toLowerCase();
  const labels = value.split(".");
  const valid =
    value.length <= 253 &&
    labels.length >= 2 &&
    labels.every((label) => label.length <= 63 && DOMAIN_LABEL.test(label));
  if (!valid) {
    return { ok: false, error: "Enter an email address, or a domain like lintech.com." };
  }
  if (PUBLIC_EMAIL_DOMAINS.has(value)) {
    return {
      ok: false,
      error:
        "Public email domains like gmail.com cannot be added as a whole domain. " +
        "Add the person's email address instead.",
    };
  }
  return { ok: true, sender: { kind: "domain", value, display } };
}

// Text with an "@" after a local part is an email address. A leading "@" or
// no "@" means a domain.
export function parseSender(input: string): ActionResult<{ sender: ParsedSender }> {
  const display = input.trim();
  if (display.indexOf("@") <= 0) return parseDomain(display);

  if (!emailSchema.safeParse(display).success) {
    return { ok: false, error: "Enter a valid email address." };
  }
  return { ok: true, sender: { kind: "email", value: normalizeGmail(display), display } };
}

export async function addSender(
  businessId: string,
  userId: string,
  input: string,
): Promise<ActionResult<{ sender: ParsedSender }>> {
  const parsed = parseSender(input);
  if (!parsed.ok) return parsed;

  const count = await db.allowedSender.count({ where: { businessId } });
  if (count >= MAX_SENDERS) {
    return { ok: false, error: `A business can have up to ${MAX_SENDERS} allowed senders.` };
  }

  try {
    await db.allowedSender.create({
      data: { businessId, createdById: userId, ...parsed.sender },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return { ok: false, error: "That sender is already on the list." };
  }
  return parsed;
}

// Drive folders are shared with single addresses, so a domain entry does not count here.
export async function isAllowedEmailSender(businessId: string, address: string) {
  const match = await db.allowedSender.findFirst({
    where: { businessId, kind: "email", value: normalizeGmail(address) },
    select: { id: true },
  });
  return match !== null;
}

// Only checks the list. Whether the mail really came from that address is checked elsewhere.
export async function isAllowedSender(businessId: string, fromAddress: string) {
  const address = fromAddress.trim().toLowerCase();
  const at = address.lastIndexOf("@");
  if (at <= 0) return false;

  const match = await db.allowedSender.findFirst({
    where: {
      businessId,
      OR: [
        { kind: "email", value: normalizeGmail(address) },
        { kind: "domain", value: address.slice(at + 1) },
      ],
    },
    select: { id: true },
  });
  return match !== null;
}
