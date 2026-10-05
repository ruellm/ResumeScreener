import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireSuperAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { INTAKE_STATUS_LABELS } from "@/lib/intake-activity";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;
// Chosen in the business filter to see mail that matched no business.
const NO_BUSINESS = "none";

const STATUSES = {
  email: ["processing", "accepted", "rejected", "ignored", "error"],
  drive: ["processing", "accepted", "skipped", "error"],
} as const;

type Tab = keyof typeof STATUSES;
type Query = Record<string, string | string[] | undefined>;

function text(value: string | string[] | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

async function emailRows(status: string, business: string, skip: number) {
  const where = {
    status: status || undefined,
    businessId: business === NO_BUSINESS ? null : business || undefined,
  };
  const [rows, total] = await Promise.all([
    db.inboundEmail.findMany({
      where,
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      skip,
      take: PAGE_SIZE,
    }),
    db.inboundEmail.count({ where }),
  ]);
  return { rows, total };
}

async function driveRows(status: string, business: string, skip: number) {
  const where = {
    status: status || undefined,
    // Every Drive row belongs to a business.
    businessId: business === NO_BUSINESS ? "" : business || undefined,
  };
  const [rows, total] = await Promise.all([
    db.driveIntakeItem.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take: PAGE_SIZE,
    }),
    db.driveIntakeItem.count({ where }),
  ]);
  return { rows, total };
}

export default async function IntakePage({ searchParams }: { searchParams: Promise<Query> }) {
  await requireSuperAdmin();
  const query = await searchParams;

  const tab: Tab = text(query.tab) === "drive" ? "drive" : "email";
  const statuses: readonly string[] = STATUSES[tab];
  const status = statuses.includes(text(query.status)) ? text(query.status) : "";
  const business = text(query.business);
  const pageNumber = Number(text(query.page));
  const page = Number.isInteger(pageNumber) && pageNumber >= 1 ? pageNumber : 1;
  const skip = (page - 1) * PAGE_SIZE;

  const [emails, driveItems, businesses] = await Promise.all([
    tab === "email" ? emailRows(status, business, skip) : null,
    tab === "drive" ? driveRows(status, business, skip) : null,
    db.business.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const jobs = await db.job.findMany({
    where: {
      id: {
        in: [...(emails?.rows ?? []), ...(driveItems?.rows ?? [])].flatMap((row) => row.jobId ?? []),
      },
    },
    select: { id: true, title: true },
  });
  const businessNames = new Map(businesses.map((row) => [row.id, row.name]));
  const jobTitles = new Map(jobs.map((row) => [row.id, row.title]));
  const total = emails?.total ?? driveItems?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function href(changes: { tab?: Tab; page?: number }) {
    const params = new URLSearchParams({ tab: changes.tab ?? tab });
    // The status lists differ, so a change of tab drops the status.
    if (status && !changes.tab) params.set("status", status);
    if (business) params.set("business", business);
    if (changes.page && changes.page > 1) params.set("page", String(changes.page));
    return `/admin/intake?${params}`;
  }

  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Intake</h1>

      <nav className="flex gap-4 border-b text-sm">
        {(["email", "drive"] as const).map((name) => (
          <Link
            key={name}
            href={href({ tab: name })}
            aria-current={tab === name ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 border-transparent px-1 pb-2",
              tab === name ? "border-foreground font-medium" : "text-muted-foreground",
            )}
          >
            {name === "email" ? "Email" : "Drive"}
          </Link>
        ))}
      </nav>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="tab" value={tab} />
        <div className="grid gap-1">
          <Label htmlFor="status">Status</Label>
          <select
            id="status"
            name="status"
            defaultValue={status}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value="">All</option>
            {statuses.map((value) => (
              <option key={value} value={value}>
                {INTAKE_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="business">Business</Label>
          <select
            id="business"
            name="business"
            defaultValue={business}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value="">All</option>
            {tab === "email" && <option value={NO_BUSINESS}>No business</option>}
            {businesses.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>

      <p className="text-sm text-muted-foreground">
        {total} row{total === 1 ? "" : "s"}
      </p>

      {total === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing here.</p>
      ) : emails ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Received</TableHead>
              <TableHead>Business</TableHead>
              <TableHead>Job</TableHead>
              <TableHead>From</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>PDFs</TableHead>
              <TableHead>Reply sent</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {emails.rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{formatDateTime(row.receivedAt)}</TableCell>
                <TableCell>{row.businessId ? businessNames.get(row.businessId) : ""}</TableCell>
                <TableCell className="max-w-40 truncate">
                  {row.jobId ? jobTitles.get(row.jobId) : ""}
                </TableCell>
                <TableCell>{row.fromAddress}</TableCell>
                <TableCell className="max-w-48 truncate" title={row.subject ?? undefined}>
                  {row.subject}
                </TableCell>
                <TableCell>{INTAKE_STATUS_LABELS[row.status] ?? row.status}</TableCell>
                <TableCell className="max-w-64 whitespace-normal">{row.reason}</TableCell>
                <TableCell>
                  {row.acceptedCount} of {row.pdfCount}
                </TableCell>
                <TableCell>{row.replySentAt ? formatDateTime(row.replySentAt) : "No"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Seen</TableHead>
              <TableHead>Business</TableHead>
              <TableHead>Job</TableHead>
              <TableHead>File</TableHead>
              <TableHead>Uploaded by</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {driveItems?.rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{formatDateTime(row.createdAt)}</TableCell>
                <TableCell>{businessNames.get(row.businessId)}</TableCell>
                <TableCell className="max-w-40 truncate">{jobTitles.get(row.jobId)}</TableCell>
                <TableCell className="max-w-48 truncate" title={row.fileName}>
                  {row.fileName}
                </TableCell>
                <TableCell>{row.uploaderEmail}</TableCell>
                <TableCell>{INTAKE_STATUS_LABELS[row.status] ?? row.status}</TableCell>
                <TableCell className="max-w-64 whitespace-normal">{row.reason}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <div className="flex items-center gap-3 text-sm">
        {page > 1 && (
          <Link href={href({ page: page - 1 })} className="underline underline-offset-4">
            Newer
          </Link>
        )}
        <span className="text-muted-foreground">
          Page {page} of {pages}
        </span>
        {page < pages && (
          <Link href={href({ page: page + 1 })} className="underline underline-offset-4">
            Older
          </Link>
        )}
      </div>
    </div>
  );
}
