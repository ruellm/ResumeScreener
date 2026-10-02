import {
  FORMULA_IGNORED_NOTE,
  MANIPULATION_NOTED_NOTE,
  MANIPULATION_REJECTION_SUMMARY,
  MANIPULATION_REVIEW_NOTE,
} from "@/lib/evaluation-result";
import type { EvaluationOutput } from "./schema";

// =HYPERLINK(...), =SUM(...) and the like.
const SPREADSHEET_FORMULA = /^=\s*[A-Za-z_.]+\s*\(/;

export type GuardedEvaluation = EvaluationOutput & { guardNotes: string[] };

// What the model gave before the resume was rejected for manipulation.
export type Rejection = Pick<EvaluationOutput, "score" | "verdict">;

function normalize(text: string) {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

// Checks the model's output against things the code can verify itself.
// extractedText is null on the VISION path, where quotes cannot be checked.
export function applyGuards(
  output: EvaluationOutput,
  extractedText: string | null,
): { result: GuardedEvaluation; evidenceVerified: boolean; rejection: Rejection | null } {
  const guardNotes: string[] = [];
  let { requirements, skills, manipulationAttempts, verdict, score, summary } = output;

  // A formula can never be a message to the reviewer, whatever the model
  // made of it, so it is removed before anything else looks at the attempts.
  const withoutFormulas = manipulationAttempts.filter(
    (attempt) => !SPREADSHEET_FORMULA.test(attempt.quote.trim()),
  );
  if (withoutFormulas.length < manipulationAttempts.length) {
    guardNotes.push(FORMULA_IGNORED_NOTE);
  }
  manipulationAttempts = withoutFormulas;

  if (extractedText !== null) {
    const resume = normalize(extractedText);
    const found = (quote: string) => resume.includes(normalize(quote));

    let quotesDropped = 0;
    let downgraded = 0;
    const check = <T extends { status: string; evidence: string | null }>(item: T): T => {
      let { status, evidence } = item;
      if (evidence !== null && !found(evidence)) {
        evidence = null;
        quotesDropped += 1;
      }
      if (evidence === null && (status === "MET" || status === "PARTIAL")) {
        status = "UNCLEAR";
        downgraded += 1;
      }
      return { ...item, status, evidence };
    };
    requirements = requirements.map(check);
    skills = skills.map(check);
    if (quotesDropped > 0) {
      guardNotes.push(`${plural(quotesDropped, "evidence quote")} not found in the resume`);
    }
    if (downgraded > 0) {
      guardNotes.push(`${plural(downgraded, "item")} set to UNCLEAR: no verified evidence`);
    }

    const verified = manipulationAttempts.filter((attempt) => found(attempt.quote));
    const dropped = manipulationAttempts.length - verified.length;
    if (dropped > 0) {
      guardNotes.push(`${plural(dropped, "manipulation quote")} not found in the resume`);
    }
    manipulationAttempts = verified;
  }

  if (
    verdict === "PASS" &&
    skills.some((skill) => skill.required && skill.status === "NOT_MET")
  ) {
    verdict = "MAYBE";
    guardNotes.push("verdict capped at MAYBE: required skill not met");
  }

  // Business rule: a resume that tries to instruct the screener fails. Only a
  // quote that was found in the text counts, and only when the model says it
  // speaks to the reviewer or dictates the outcome. On page images the quote
  // cannot be checked, so that case goes to a person instead.
  let rejection: Rejection | null = null;
  if (manipulationAttempts.some((attempt) => attempt.kind !== "other")) {
    if (extractedText !== null) {
      rejection = { score, verdict };
      guardNotes.push(`Rejected for manipulation (score before rejection: ${score})`);
      verdict = "FAIL";
      score = 0;
      summary = `${MANIPULATION_REJECTION_SUMMARY} ${summary}`;
    } else {
      if (verdict === "PASS") verdict = "MAYBE";
      guardNotes.push(MANIPULATION_REVIEW_NOTE);
    }
  }
  if (manipulationAttempts.some((attempt) => attempt.kind === "other")) {
    guardNotes.push(MANIPULATION_NOTED_NOTE);
  }

  return {
    result: {
      ...output,
      verdict,
      score,
      summary,
      requirements,
      skills,
      manipulationAttempts,
      guardNotes,
    },
    evidenceVerified: extractedText !== null,
    rejection,
  };
}
