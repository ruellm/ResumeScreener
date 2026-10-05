const GMAIL_DOMAINS = ["gmail.com", "googlemail.com"];

// Gmail ignores dots and anything after "+" in the local part.
export function normalizeGmail(email: string) {
  const lower = email.trim().toLowerCase();
  const at = lower.lastIndexOf("@");
  if (at < 0) return lower;

  const domain = lower.slice(at + 1);
  if (!GMAIL_DOMAINS.includes(domain)) return lower;

  const local = lower.slice(0, at).split("+")[0].replaceAll(".", "");
  return `${local}@${domain}`;
}
