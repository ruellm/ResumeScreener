import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { ImportError } from "./errors";

export const POSTING_MAX_CHARS = 20_000;
// Less than this is a login wall, a cookie notice or an empty shell.
const MIN_CONTENT_CHARS = 300;

export type ExtractedPosting = {
  source: "structured data" | "page text";
  title: string | null;
  text: string;
};

type Json = null | string | number | boolean | Json[] | { [key: string]: Json };

const BLOCK_TAGS = new Set([
  "P", "DIV", "SECTION", "ARTICLE", "UL", "OL", "LI", "TR", "TABLE",
  "H1", "H2", "H3", "H4", "H5", "H6", "HR", "BLOCKQUOTE", "DT", "DD",
]);

function tidy(text: string) {
  return text
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Text of a piece of HTML with its line structure kept: one line per block,
// list items marked with a dash.
function nodeText(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? "";
  if (node.nodeType !== 1 && node.nodeType !== 11) return "";
  const tag = (node as Element).tagName ?? "";
  if (["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"].includes(tag)) return "";

  const inner = [...node.childNodes].map(nodeText).join("");
  if (tag === "BR") return "\n";
  if (tag === "LI") return `\n- ${inner.trim()}\n`;
  return BLOCK_TAGS.has(tag) ? `\n${inner}\n` : inner;
}

export function htmlToText(html: string) {
  return tidy(nodeText(JSDOM.fragment(html)));
}

function isJobPosting(value: Json): value is { [key: string]: Json } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const type = value["@type"];
  return type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"));
}

// The first JobPosting anywhere in the data: at the top, in an array, in
// @graph or nested inside another object.
function findJobPosting(value: Json, depth = 0): { [key: string]: Json } | null {
  if (depth > 6 || typeof value !== "object" || value === null) return null;
  if (isJobPosting(value)) return value;
  const children: Json[] = Array.isArray(value) ? value : Object.values(value);
  for (const child of children) {
    const found = findJobPosting(child, depth + 1);
    if (found) return found;
  }
  return null;
}

// A readable line for any value: text as is, lists joined, objects as their
// own values without the schema.org bookkeeping.
function flatten(value: Json | undefined): string {
  if (value === null || value === undefined || typeof value === "boolean") return "";
  if (typeof value === "string") {
    // Some sites escape the markup once more: "&lt;p&gt;" becomes "<p>" first.
    const markup = /&lt;\/?[a-z]/i.test(value) ? JSDOM.fragment(value).textContent ?? "" : value;
    return /<[a-z][^>]*>|&[a-z#0-9]+;/i.test(markup) ? htmlToText(markup) : markup.trim();
  }
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(flatten).filter(Boolean).join(", ");
  return Object.entries(value)
    .filter(([key]) => !key.startsWith("@"))
    .map(([, child]) => flatten(child))
    .filter(Boolean)
    .join(" ");
}

function structuredText(posting: { [key: string]: Json }) {
  const organization = posting.hiringOrganization;
  const company =
    typeof organization === "object" && organization !== null && !Array.isArray(organization)
      ? flatten(organization.name)
      : flatten(organization);

  const lines: [string, string][] = [
    ["Title", flatten(posting.title)],
    ["Company", company],
    ["Location", flatten(posting.jobLocation)],
    ["Employment type", flatten(posting.employmentType)],
    ["Salary", flatten(posting.baseSalary)],
    ["Date posted", flatten(posting.datePosted)],
    ["Description", flatten(posting.description)],
    ["Responsibilities", flatten(posting.responsibilities)],
    ["Qualifications", flatten(posting.qualifications)],
    ["Skills", flatten(posting.skills)],
    ["Experience requirements", flatten(posting.experienceRequirements)],
    ["Education requirements", flatten(posting.educationRequirements)],
  ];
  return lines
    .filter(([, value]) => value)
    .map(([label, value]) => (value.includes("\n") ? `${label}:\n${value}` : `${label}: ${value}`))
    .join("\n\n");
}

function fromStructuredData(document: Document): ExtractedPosting | null {
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    let data: Json;
    try {
      data = JSON.parse(script.textContent ?? "");
    } catch {
      continue;
    }
    const posting = findJobPosting(data);
    if (!posting) continue;
    return {
      source: "structured data",
      title: flatten(posting.title) || null,
      text: structuredText(posting),
    };
  }
  return null;
}

function fromPageText(document: Document): ExtractedPosting {
  for (const element of document.querySelectorAll(
    "script, style, noscript, template, nav, footer, svg, iframe, form",
  )) {
    element.remove();
  }
  const pageTitle = document.title.trim() || null;

  // Readability changes the document, so the plain text is taken first.
  const whole = tidy(nodeText(document.body ?? document.documentElement));
  const article = new Readability(document).parse();
  const main = article?.content ? htmlToText(article.content) : "";

  // When it picks out too little, the whole page says more.
  return {
    source: "page text",
    title: article?.title?.trim() || pageTitle,
    text: main.length >= MIN_CONTENT_CHARS ? main : whole,
  };
}

function realLength(text: string) {
  return text.replace(/\s+/g, "").length;
}

// The job posting in a page, as text for the model. Throws the "blocked"
// error when the page holds no real content, which is what a login wall or a
// page drawn by scripts looks like from here.
export function extractPosting(html: Buffer | string, url: string, contentType?: string): ExtractedPosting {
  // Always read as HTML: pages that call themselves XHTML are rarely valid XML.
  // The charset the server named is kept. Scripts are not run and nothing else is loaded.
  const charset = /charset=[^;]+/i.exec(contentType ?? "")?.[0];
  const { document } = new JSDOM(html, {
    url,
    contentType: charset ? `text/html; ${charset}` : "text/html",
  }).window;

  const structured = fromStructuredData(document);
  const posting =
    structured && realLength(structured.text) >= MIN_CONTENT_CHARS
      ? structured
      : fromPageText(document);

  if (realLength(posting.text) < MIN_CONTENT_CHARS) throw new ImportError("blocked");
  return { ...posting, text: posting.text.slice(0, POSTING_MAX_CHARS) };
}
