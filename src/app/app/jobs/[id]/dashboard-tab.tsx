import Form from "next/form";
import Link from "next/link";
import { EyeOff, ScanLine, ShieldAlert } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { VerdictBadge } from "@/components/verdict-badge";
import {
  DASHBOARD_PAGE_SIZE,
  dashboardCounts,
  dashboardHref,
  dashboardRows,
  parseDashboardFilters,
  type DashboardFilters,
  type DashboardRow,
} from "@/lib/dashboard";
import { REJECTION_TITLE } from "@/lib/evaluation-result";
import { formatDateTime } from "@/lib/format";
import { SUBMISSION_STATUS_LABELS } from "@/lib/uploads";
import { DeleteSubmissionButton } from "./delete-submission-button";

const REFRESH_MS = 10_000;

const SELECT_CLASS = "h-8 rounded-lg border border-input bg-transparent px-2 text-sm";

function Flag({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <span title={label} aria-label={label} role="img">
      {children}
    </span>
  );
}

function Flags({ row }: { row: DashboardRow }) {
  const attempts = row.evaluation?.manipulationAttemptsJson;
  const hasAttempts = Array.isArray(attempts) && attempts.length > 0;
  return (
    <div className="flex gap-1.5">
      {hasAttempts && (
        <Flag
          label={
            row.evaluation?.rejectedForManipulation
              ? REJECTION_TITLE
              : "Possible manipulation text, see the result"
          }
        >
          <ShieldAlert className="size-4 text-destructive" />
        </Flag>
      )}
      {row.hasHiddenText && (
        <Flag label="Hidden text was found and removed">
          <EyeOff className="size-4" />
        </Flag>
      )}
      {row.extractionMethod === "VISION" && (
        <Flag label="Read from page images">
          <ScanLine className="size-4" />
        </Flag>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

type DashboardTabProps = {
  jobId: string;
  query: Record<string, string | string[] | undefined>;
};

export async function DashboardTab({ jobId, query }: DashboardTabProps) {
  const filters = parseDashboardFilters(query);
  const [counts, { rows, total }] = await Promise.all([
    dashboardCounts(jobId),
    dashboardRows(jobId, filters),
  ]);
  const pages = Math.max(1, Math.ceil(total / DASHBOARD_PAGE_SIZE));
  const pageHref = (page: number) => dashboardHref(jobId, { ...filters, page });

  // Each counter links to the one filter that gives exactly those rows.
  const counters: { label: string; value: number; filter: Partial<DashboardFilters> }[] = [
    { label: "Total", value: counts.total, filter: {} },
    { label: "Pass", value: counts.pass, filter: { verdict: "pass" } },
    { label: "Maybe", value: counts.maybe, filter: { verdict: "maybe" } },
    { label: "Fail", value: counts.fail, filter: { verdict: "fail" } },
    { label: "Rejected", value: counts.rejected, filter: { verdict: "rejected" } },
    { label: "Processing failed", value: counts.failed, filter: { status: "failed" } },
    { label: "In progress", value: counts.inProgress, filter: { status: "in_progress" } },
  ];

  return (
    <div className="grid gap-6">
      {counts.inProgress > 0 && <AutoRefresh intervalMs={REFRESH_MS} />}

      <div className="flex flex-wrap gap-2">
        {counters.map((counter) => (
          <Link
            key={counter.label}
            href={dashboardHref(jobId, counter.filter)}
            className="grid min-w-24 gap-0.5 rounded-lg border px-3 py-2 hover:bg-muted"
          >
            <span className="text-xl font-semibold tabular-nums">{counter.value}</span>
            <span className="text-xs text-muted-foreground">{counter.label}</span>
          </Link>
        ))}
      </div>

      {/* The key resets the fields when the filters change through a link. */}
      <Form
        key={JSON.stringify(filters)}
        action={`/app/jobs/${jobId}`}
        className="flex flex-wrap items-end gap-3"
      >
        <input type="hidden" name="tab" value="dashboard" />
        <Field label="Search">
          <Input
            name="q"
            defaultValue={filters.q}
            placeholder="Candidate or file name"
            className="w-56"
          />
        </Field>
        <Field label="Verdict">
          <select name="verdict" defaultValue={filters.verdict ?? ""} className={SELECT_CLASS}>
            <option value="">Any</option>
            <option value="pass">Pass</option>
            <option value="maybe">Maybe</option>
            <option value="fail">Fail</option>
            <option value="rejected">Rejected</option>
          </select>
        </Field>
        <Field label="Status">
          <select name="status" defaultValue={filters.status ?? ""} className={SELECT_CLASS}>
            <option value="">Any</option>
            <option value="in_progress">In progress</option>
            <option value="done">Done</option>
            <option value="failed">Failed</option>
          </select>
        </Field>
        <Field label="Source">
          <select name="source" defaultValue={filters.source ?? ""} className={SELECT_CLASS}>
            <option value="">Any</option>
            <option value="WEB">Web</option>
            <option value="EMAIL">Email</option>
            <option value="DRIVE">Drive</option>
          </select>
        </Field>
        <Field label="Sort by">
          <select name="sort" defaultValue={filters.sort} className={SELECT_CLASS}>
            <option value="received">Received, newest first</option>
            <option value="score">Score, highest first</option>
          </select>
        </Field>
        <label className="flex h-8 items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="flagged"
            value="1"
            defaultChecked={filters.flagged}
            className="size-4"
          />
          Flagged only
        </label>
        <Button type="submit" size="sm">
          Apply
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href={dashboardHref(jobId)}>Clear</Link>
        </Button>
      </Form>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No submissions match.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Received</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>File</TableHead>
              <TableHead>Candidate</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Verdict</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Flags</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{formatDateTime(row.receivedAt)}</TableCell>
                <TableCell>{row.source}</TableCell>
                <TableCell className="whitespace-normal">{row.originalFilename}</TableCell>
                <TableCell>{row.evaluation?.candidateName}</TableCell>
                <TableCell>
                  {row.status === "RECEIVED" ? null : SUBMISSION_STATUS_LABELS[row.status]}
                </TableCell>
                <TableCell>
                  {row.evaluation && (
                    <VerdictBadge
                      verdict={row.evaluation.verdict}
                      rejected={row.evaluation.rejectedForManipulation}
                    />
                  )}
                </TableCell>
                <TableCell>{row.evaluation?.score}</TableCell>
                <TableCell>
                  <Flags row={row} />
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/app/jobs/${jobId}/results/${row.id}`}>View</Link>
                    </Button>
                    <DeleteSubmissionButton
                      jobId={jobId}
                      submissionId={row.id}
                      fileName={row.originalFilename}
                      size="sm"
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <div className="flex items-center gap-3 text-sm">
        <span className="text-muted-foreground">
          {total} {total === 1 ? "submission" : "submissions"}, page {filters.page} of {pages}
        </span>
        {filters.page > 1 && (
          <Button asChild variant="outline" size="sm">
            <Link href={pageHref(filters.page - 1)}>Previous</Link>
          </Button>
        )}
        {filters.page < pages && (
          <Button asChild variant="outline" size="sm">
            <Link href={pageHref(filters.page + 1)}>Next</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
