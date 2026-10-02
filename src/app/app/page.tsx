import Link from "next/link";
import type { JobStatus } from "@prisma/client";
import { JobStatusBadge } from "@/components/job-status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireBusinessUser } from "@/lib/auth";
import { verdictCounts } from "@/lib/dashboard";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { JOB_STATUS_LABELS } from "@/lib/job-status";
import { effectiveRetentionDays } from "@/lib/retention";

const FILTERS: { value: JobStatus | "ALL"; label: string }[] = [
  { value: "ACTIVE", label: JOB_STATUS_LABELS.ACTIVE },
  { value: "CLOSED", label: JOB_STATUS_LABELS.CLOSED },
  { value: "ARCHIVED", label: JOB_STATUS_LABELS.ARCHIVED },
  { value: "ALL", label: "All" },
];

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const user = await requireBusinessUser();
  const { status } = await searchParams;

  const filter = FILTERS.find((item) => item.value === status)?.value ?? "ACTIVE";

  const jobs = await db.job.findMany({
    where: {
      businessId: user.business.id,
      ...(filter !== "ALL" && { status: filter }),
    },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: {
        select: {
          skills: true,
          // Uploads that were never confirmed are not submissions yet.
          submissions: { where: { status: { not: "RECEIVED" } } },
        },
      },
    },
  });
  const [verdicts, settings] = await Promise.all([
    verdictCounts(jobs.map((job) => job.id)),
    db.settings.findUniqueOrThrow({ where: { id: 1 } }),
  ]);
  const retentionDays = effectiveRetentionDays(user.business, settings);

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Jobs</h1>
        <Button asChild>
          <Link href="/app/jobs/new">New job</Link>
        </Button>
      </div>

      <div className="flex gap-2">
        {FILTERS.map((item) => (
          <Button
            key={item.value}
            asChild
            size="sm"
            variant={item.value === filter ? "default" : "outline"}
          >
            <Link href={item.value === "ACTIVE" ? "/app" : `/app?status=${item.value}`}>
              {item.label}
            </Link>
          </Button>
        ))}
      </div>

      {jobs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No jobs found.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Title</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Skills</TableHead>
              <TableHead>Submissions</TableHead>
              <TableHead>Pass</TableHead>
              <TableHead>Maybe</TableHead>
              <TableHead>Fail</TableHead>
              <TableHead>Rejected</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.map((job) => (
              <TableRow key={job.id}>
                <TableCell className="whitespace-normal">
                  <Link
                    href={`/app/jobs/${job.id}`}
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    {job.title}
                  </Link>
                </TableCell>
                <TableCell>
                  <JobStatusBadge status={job.status} />
                </TableCell>
                <TableCell>{job._count.skills}</TableCell>
                <TableCell>{job._count.submissions}</TableCell>
                <TableCell>{verdicts.get(job.id)?.pass}</TableCell>
                <TableCell>{verdicts.get(job.id)?.maybe}</TableCell>
                <TableCell>{verdicts.get(job.id)?.fail}</TableCell>
                <TableCell>{verdicts.get(job.id)?.rejected}</TableCell>
                <TableCell>{formatDate(job.createdAt)}</TableCell>
                <TableCell>{formatDate(job.updatedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <p className="text-sm text-muted-foreground">
        Resumes and results are deleted {retentionDays} days after they are received.
      </p>
    </div>
  );
}
