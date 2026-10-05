import { getDomain } from "tldts";

const TRUSTED_AUTHSERV_ID = "mx.google.com";

export type AuthSummary = {
  authservId: string | null;
  dmarc: { result: string; headerFrom: string | null } | null;
  dkim: { result: string; domain: string | null }[];
  spf: { result: string; mailfrom: string | null } | null;
  // What the sender was verified by, null when nothing matched.
  verifiedBy: "dmarc" | "dkim" | "spf" | null;
};

type ResInfo = { method: string; result: string; props: Map<string, string> };

// Removes "(comments)", which may nest and may hold semicolons, and splits on
// ";" outside quoted strings.
function splitHeader(value: string) {
  const segments: string[] = [];
  let current = "";
  let depth = 0;
  let quoted = false;

  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (char === "\\" && (quoted || depth > 0)) {
      if (depth === 0) current += value[i + 1] ?? "";
      i++;
    } else if (quoted) {
      if (char === '"') quoted = false;
      else current += char;
    } else if (depth > 0) {
      if (char === "(") depth++;
      else if (char === ")") depth--;
    } else if (char === '"') {
      quoted = true;
    } else if (char === "(") {
      depth++;
      current += " ";
    } else if (char === ";") {
      segments.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  segments.push(current);
  return segments.map((segment) => segment.replace(/\s+/g, " ").trim());
}

function parseResInfo(segment: string): ResInfo | null {
  const [first, ...rest] = segment.split(" ");
  const match = /^([a-z0-9-]+)=([a-z]+)$/i.exec(first ?? "");
  if (!match) return null;

  const props = new Map<string, string>();
  for (const token of rest) {
    const eq = token.indexOf("=");
    if (eq > 0) props.set(token.slice(0, eq).toLowerCase(), token.slice(eq + 1).toLowerCase());
  }
  return { method: match[1].toLowerCase(), result: match[2].toLowerCase(), props };
}

function parseHeader(value: string) {
  const [id, ...segments] = splitHeader(value);
  // The id may be followed by a version number.
  const authservId = (id ?? "").split(" ")[0].toLowerCase();
  return {
    authservId,
    results: segments.flatMap((segment) => parseResInfo(segment) ?? []),
  };
}

function domainOf(value: string | undefined) {
  if (!value) return null;
  const domain = value.slice(value.lastIndexOf("@") + 1).replace(/[<>]/g, "");
  return domain || null;
}

// The part of a domain that someone registered, such as lintech.com for
// hr.lintech.com. Null for a bare public suffix such as co.uk.
function registrable(domain: string | null) {
  return domain ? getDomain(domain, { allowPrivateDomains: true }) : null;
}

// headers: every Authentication-Results value, in the order they appear in the
// message. Gmail puts its own on top, so anything below the first one with its
// id was written by someone else and is not read.
export function verifySender(headers: string[], fromAddress: string): AuthSummary {
  const summary: AuthSummary = {
    authservId: null,
    dmarc: null,
    dkim: [],
    spf: null,
    verifiedBy: null,
  };

  const trusted = headers.map(parseHeader).find((header) => header.authservId === TRUSTED_AUTHSERV_ID);
  if (!trusted) return summary;
  summary.authservId = trusted.authservId;

  for (const { method, result, props } of trusted.results) {
    if (method === "dmarc" && !summary.dmarc) {
      summary.dmarc = { result, headerFrom: domainOf(props.get("header.from")) };
    } else if (method === "dkim") {
      summary.dkim.push({
        result,
        domain: domainOf(props.get("header.d")) ?? domainOf(props.get("header.i")),
      });
    } else if (method === "spf" && !summary.spf) {
      summary.spf = { result, mailfrom: domainOf(props.get("smtp.mailfrom")) };
    }
  }

  const fromDomain = domainOf(fromAddress.toLowerCase());
  const fromRegistrable = registrable(fromDomain);
  const aligned = (domain: string | null) =>
    fromRegistrable !== null && registrable(domain) === fromRegistrable;

  if (summary.dmarc?.result === "pass" && summary.dmarc.headerFrom === fromDomain) {
    summary.verifiedBy = "dmarc";
  } else if (summary.dkim.some((dkim) => dkim.result === "pass" && aligned(dkim.domain))) {
    summary.verifiedBy = "dkim";
  } else if (summary.spf?.result === "pass" && aligned(summary.spf.mailfrom)) {
    summary.verifiedBy = "spf";
  }
  return summary;
}
