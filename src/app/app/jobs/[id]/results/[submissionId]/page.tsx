import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { VerdictBadge } from "@/components/verdict-badge";
import { db } from "@/lib/db";
import {
  FLAG_TEXTS,
  hadHiddenText,
  ITEM_STATUS_LABELS,
  MANIPULATION_REVIEW_NOTE,
  parseEvaluationResult,
  parseJobSnapshot,
  REJECTION_TITLE,
} from "@/lib/evaluation-result";
import { formatDateTime } from "@/lib/format";
import { requireJob } from "@/lib/job-access";
import { buildJobBlock } from "@/lib/job-block";
import { SUBMISSION_STATUS_LABELS } from "@/lib/uploads";
import { DeleteSubmissionButton } from "../../delete-submission-button";
import { ReevaluateButton } from "./result-controls";

const REFRESH_MS = 3000;

function Banner({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-2 rounded-lg border bg-muted/50 p-3 text-sm">{children}</div>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2">
      <h2 className="font-medium">{title}</h2>
      {children}
    </section>
  );
}

function Bullets({ items }: { items: string[] }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">None.</p>;
  return (
    <ul className="grid list-disc gap-1 pl-5 text-sm">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

function Evidence({ quote }: { quote: string | null }) {
  return quote ? <span>&quot;{quote}&quot;</span> : null;
}

export default async function ResultPage({
  params,
}: {
  params: Promise<{ id: string; submissionId: string }>;
}) {
  const { id, submissionId } = await params;
  const { job } = await requireJob(id);

  const submission = await db.submission.findFirst({
    where: { id: submissionId, jobId: job.id },
    include: { evaluation: true },
  });
  if (!submission) notFound();

  const { evaluation, status } = submission;
  const inProgress = status !== "DONE" && status !== "FAILED";
  const reevaluate = <ReevaluateButton jobId={job.id} submissionId={submission.id} />;
  const remove = (
    <DeleteSubmissionButton
      jobId={job.id}
      submissionId={submission.id}
      fileName={submission.originalFilename}
      redirectTo={`/app/jobs/${job.id}?tab=dashboard`}
    />
  );
  const backLink = (
    <Link
      href={`/app/jobs/${job.id}?tab=evaluate`}
      className="text-sm text-muted-foreground underline-offset-4 hover:underline"
    >
      Back to {job.title}
    </Link>
  );

  if (!evaluation) {
    return (
      <div className="grid gap-4">
        {backLink}
        <h1 className="text-xl font-semibold">{submission.originalFilename}</h1>
        <p>Status: {SUBMISSION_STATUS_LABELS[status]}</p>
        {status === "FAILED" && (
          <>
            <p role="alert" className="text-sm text-destructive">
              {submission.error}
            </p>
            <div>{reevaluate}</div>
          </>
        )}
        <div>{remove}</div>
        {inProgress && <AutoRefresh intervalMs={REFRESH_MS} />}
      </div>
    );
  }

  const result = parseEvaluationResult(evaluation.resultJson);
  const snapshot = parseJobSnapshot(evaluation.jobSnapshotJson);
  // Compared as text, so only a change to what the model is given counts.
  // Closing or reopening the job does not.
  const jobSkills = await db.jobSkill.findMany({
    where: { jobId: job.id },
    select: { isRequired: true, skill: { select: { name: true } } },
  });
  const jobChanged =
    snapshot.block !== null && buildJobBlock({ ...job, skills: jobSkills }) !== snapshot.block;
  const contact = [evaluation.candidateEmail, evaluation.candidatePhone].filter(Boolean);
  const rejected = evaluation.rejectedForManipulation;

  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        {backLink}
        <h1 className="text-xl font-semibold">
          {evaluation.candidateName ?? submission.originalFilename}
        </h1>
        {contact.length > 0 && (
          <p className="text-sm text-muted-foreground">{contact.join(" | ")}</p>
        )}
      </div>

      {inProgress && (
        <Banner>
          <p>Re-evaluating... This is the earlier result. The page updates when the new one is ready.</p>
          <AutoRefresh intervalMs={REFRESH_MS} />
        </Banner>
      )}
      {status === "FAILED" && (
        <Banner>
          <p>The last evaluation failed: {submission.error} This is the earlier result.</p>
        </Banner>
      )}

      {rejected && (
        <div className="grid gap-2 rounded-lg border border-destructive bg-destructive/10 p-3 text-sm">
          <p className="font-medium text-destructive">{REJECTION_TITLE}</p>
          <ul className="grid gap-1 pl-4">
            {result.manipulationAttempts
              .filter((attempt) => attempt.kind !== "other")
              .map((attempt, index) => (
                <li key={index}>&quot;{attempt.quote}&quot;</li>
              ))}
          </ul>
          {evaluation.preRejectionScore !== null && (
            <p>Score before rejection: {evaluation.preRejectionScore}</p>
          )}
        </div>
      )}

      <div className="grid gap-2">
        <div className="flex items-center gap-3">
          <VerdictBadge verdict={evaluation.verdict} rejected={rejected} />
          <span className="font-medium">Score {evaluation.score} of 100</span>
        </div>
        <p className="text-sm">{evaluation.summary}</p>
      </div>

      {!rejected && result.manipulationAttempts.length > 0 && (
        <Banner>
          <p>{FLAG_TEXTS.manipulation}</p>
          <ul className="grid gap-1 pl-4">
            {result.manipulationAttempts.map((attempt, index) => (
              <li key={index}>&quot;{attempt.quote}&quot;</li>
            ))}
          </ul>
          {result.guardNotes.includes(MANIPULATION_REVIEW_NOTE) && (
            <p>{MANIPULATION_REVIEW_NOTE}</p>
          )}
        </Banner>
      )}
      {hadHiddenText(submission.hiddenTextFlagsJson) && (
        <Banner>
          <p>{FLAG_TEXTS.hiddenText}</p>
        </Banner>
      )}
      {!evaluation.evidenceVerified && (
        <Banner>
          <p>{FLAG_TEXTS.vision}</p>
        </Banner>
      )}
      {jobChanged && (
        <Banner>
          <p>The job changed since this evaluation. Re-evaluate to score against the current job.</p>
          {!inProgress && <div>{reevaluate}</div>}
        </Banner>
      )}

      <Section title="Requirements">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Requirement</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Evidence</TableHead>
              <TableHead>Note</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.requirements.map((item, index) => (
              <TableRow key={index}>
                <TableCell className="align-top whitespace-normal">{item.requirement}</TableCell>
                <TableCell className="align-top">{ITEM_STATUS_LABELS[item.status]}</TableCell>
                <TableCell className="align-top whitespace-normal">
                  <Evidence quote={item.evidence} />
                </TableCell>
                <TableCell className="align-top whitespace-normal">{item.note}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section title="Skills">
        {result.skills.length === 0 ? (
          <p className="text-sm text-muted-foreground">The job listed no skills.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Skill</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Evidence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.skills.map((item, index) => (
                <TableRow key={index}>
                  <TableCell className="align-top">{item.skill}</TableCell>
                  <TableCell className="align-top">
                    {item.required ? "Required" : "Optional"}
                  </TableCell>
                  <TableCell className="align-top">{ITEM_STATUS_LABELS[item.status]}</TableCell>
                  <TableCell className="align-top whitespace-normal">
                    <Evidence quote={item.evidence} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section title="Strengths">
        <Bullets items={result.strengths} />
      </Section>
      <Section title="Gaps">
        <Bullets items={result.gaps} />
      </Section>

      <dl className="grid gap-1 text-sm text-muted-foreground">
        <div>File: {submission.originalFilename}</div>
        <div>Source: {submission.source}</div>
        <div>Received: {formatDateTime(submission.receivedAt)}</div>
        <div>Evaluated: {formatDateTime(evaluation.createdAt)}</div>
        <div>Model: {evaluation.model}</div>
        <div>Prompt version: {evaluation.promptVersion}</div>
        {result.guardNotes.length > 0 && <div>Guard notes: {result.guardNotes.join("; ")}</div>}
      </dl>

      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <a href={`/api/jobs/${job.id}/results/${submission.id}/pdf`}>Download result PDF</a>
        </Button>
        <Button asChild variant="outline">
          <a href={`/api/jobs/${job.id}/results/${submission.id}/resume`}>
            Download original resume
          </a>
        </Button>
        {!inProgress && reevaluate}
        {remove}
      </div>
    </div>
  );
}
