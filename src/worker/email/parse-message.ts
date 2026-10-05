import addressParser from "email-addresses";
import { isEmailAlias } from "@/lib/email-alias";
import { normalizeGmail } from "@/lib/google/normalize-gmail";
import type { MailMessage, MailPart } from "./mailbox";

const SUBJECT_MAX_CHARS = 300;
const SUBJECT_CODE = /JOB-([A-Za-z0-9]{8})/i;

export type MessageHeaders = {
  // Every value of a header, in the order they appear in the message.
  all(name: string): string[];
  first(name: string): string | null;
};

export function readHeaders(message: MailMessage): MessageHeaders {
  const headers = message.payload?.headers ?? [];
  const all = (name: string) =>
    headers.flatMap((header) =>
      header.name?.toLowerCase() === name.toLowerCase() ? [header.value ?? ""] : [],
    );
  return { all, first: (name) => all(name)[0] ?? null };
}

// Lowercase addresses. Null when the text is not a valid address list.
// Members of a group count as addresses of the list.
export function parseAddresses(value: string): string[] | null {
  const parsed = addressParser.parseAddressList({ input: value, rfc6532: true });
  if (!parsed) return null;
  return parsed.flatMap((entry) =>
    entry.type === "group"
      ? entry.addresses.map((member) => member.address.toLowerCase())
      : [entry.address.toLowerCase()],
  );
}

// The one sender address, or null when there is not exactly one.
export function parseFrom(headers: MessageHeaders) {
  const values = headers.all("From");
  if (values.length !== 1) return null;
  const parsed = addressParser.parseAddressList({ input: values[0], rfc6532: true });
  if (!parsed || parsed.length !== 1 || parsed[0].type !== "mailbox") return null;
  return parsed[0].address.toLowerCase();
}

function localPart(address: string) {
  return address.slice(0, address.lastIndexOf("@"));
}

function isBounceAddress(address: string) {
  return ["mailer-daemon", "postmaster"].includes(localPart(address));
}

// Mail that a machine sent, or the mailbox's own mail. Null when the message
// should be looked at.
export function ignoreReason(headers: MessageHeaders, systemAccount: string) {
  const senders = headers.all("From").flatMap((value) => parseAddresses(value) ?? []);
  const system = normalizeGmail(systemAccount);
  if (senders.some((sender) => normalizeGmail(sender) === system)) {
    return "Sent by the system account";
  }
  if (senders.some(isBounceAddress)) return "Bounce or postmaster message";

  const returnPath = headers.first("Return-Path")?.trim();
  if (returnPath === "<>") return "Empty return path";
  if (returnPath && isBounceAddress(returnPath.replace(/[<>]/g, "").toLowerCase())) {
    return "Bounce or postmaster message";
  }

  const autoSubmitted = headers.first("Auto-Submitted")?.trim().toLowerCase();
  if (autoSubmitted !== undefined && !autoSubmitted.startsWith("no")) return "Automatic message";

  const precedence = headers.first("Precedence")?.trim().toLowerCase();
  if (precedence && ["bulk", "list", "junk"].includes(precedence)) return "Bulk message";

  if (headers.first("List-Id") !== null) return "Mailing list message";
  return null;
}

// Job codes the message carries, most trusted first: the +tag of an address
// that is the system mailbox, then a JOB-code in the subject.
export function jobAliases(headers: MessageHeaders, systemAccount: string) {
  const system = normalizeGmail(systemAccount);
  const aliases: string[] = [];

  const recipients = ["To", "Cc", "Delivered-To"].flatMap((name) =>
    headers.all(name).flatMap((value) => parseAddresses(value) ?? []),
  );
  for (const recipient of recipients) {
    const local = localPart(recipient);
    const plus = local.indexOf("+");
    if (plus < 0) continue;
    const mailbox = local.slice(0, plus) + recipient.slice(local.length);
    const tag = local.slice(plus + 1);
    if (normalizeGmail(mailbox) === system && isEmailAlias(tag)) aliases.push(tag);
  }

  const code = SUBJECT_CODE.exec(headers.first("Subject") ?? "")?.[1].toLowerCase();
  if (code) aliases.push(code);
  return [...new Set(aliases)];
}

export function storedSubject(headers: MessageHeaders) {
  return headers.first("Subject")?.slice(0, SUBJECT_MAX_CHARS) ?? null;
}

export type PdfPart = {
  filename: string;
  size: number;
  attachmentId: string | null;
  // Small parts come with their content.
  data: string | null;
};

function partHeader(part: MailPart, name: string) {
  return part.headers?.find((header) => header.name?.toLowerCase() === name)?.value ?? null;
}

// Every PDF attached anywhere in the message, in order.
export function pdfParts(message: MailMessage): PdfPart[] {
  const found: PdfPart[] = [];

  function walk(part: MailPart) {
    const filename = part.filename?.trim() ?? "";
    const isPdf =
      filename.toLowerCase().endsWith(".pdf") ||
      part.mimeType?.toLowerCase() === "application/pdf";
    // An image or file placed inside the message text, not attached to it.
    const inline = !filename && partHeader(part, "content-id") !== null;

    if (isPdf && !inline && (part.body?.attachmentId || part.body?.data)) {
      found.push({
        filename: (filename || `attachment-${found.length + 1}.pdf`).slice(0, 255),
        size: part.body.size ?? 0,
        attachmentId: part.body.attachmentId ?? null,
        data: part.body.data ?? null,
      });
    }
    part.parts?.forEach(walk);
  }

  if (message.payload) walk(message.payload);
  return found;
}
