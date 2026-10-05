import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const PAGE_SIZE = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

type Query = Record<string, string | string[] | undefined>;

function text(value: string | string[] | undefined) {
  return typeof value === "string" ? value.trim() : "";
}

// A day as typed in a date field, read as UTC. Null when it is not a date.
function day(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export default async function EventsPage({ searchParams }: { searchParams: Promise<Query> }) {
  await requireSuperAdmin();
  const query = await searchParams;

  const filters = {
    business: text(query.business),
    type: text(query.type).slice(0, 100),
    from: text(query.from),
    to: text(query.to),
  };
  const pageNumber = Number(text(query.page));
  const page = Number.isInteger(pageNumber) && pageNumber >= 1 ? pageNumber : 1;
  const from = day(filters.from);
  const to = day(filters.to);

  const where: Prisma.EventLogWhereInput = {
    businessId: filters.business || undefined,
    type: filters.type ? { startsWith: filters.type } : undefined,
    createdAt: {
      gte: from ?? undefined,
      // The whole "to" day counts.
      lt: to ? new Date(to.getTime() + DAY_MS) : undefined,
    },
  };

  const [events, total, businesses] = await Promise.all([
    db.eventLog.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.eventLog.count({ where }),
    db.business.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const businessNames = new Map(businesses.map((business) => [business.id, business.name]));
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function href(target: number) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    if (target > 1) params.set("page", String(target));
    return `/admin/events?${params}`;
  }

  return (
    <div className="grid gap-4">
      <h1 className="text-xl font-semibold">Events</h1>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1">
          <Label htmlFor="business">Business</Label>
          <select
            id="business"
            name="business"
            defaultValue={filters.business}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value="">All</option>
            {businesses.map((business) => (
              <option key={business.id} value={business.id}>
                {business.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="type">Type starts with</Label>
          <Input id="type" name="type" defaultValue={filters.type} placeholder="drive." />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="from">From</Label>
          <Input id="from" name="from" type="date" defaultValue={filters.from} />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="to">To</Label>
          <Input id="to" name="to" type="date" defaultValue={filters.to} />
        </div>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>

      <p className="text-sm text-muted-foreground">
        {total} event{total === 1 ? "" : "s"}. Dates are in UTC.
      </p>

      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">No events.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Business</TableHead>
              <TableHead>Message</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event) => (
              <TableRow key={event.id}>
                <TableCell>{formatDateTime(event.createdAt)}</TableCell>
                <TableCell>{event.type}</TableCell>
                <TableCell>
                  {event.businessId ? (businessNames.get(event.businessId) ?? event.businessId) : ""}
                </TableCell>
                <TableCell className="max-w-64 whitespace-normal">{event.message}</TableCell>
                <TableCell className="max-w-md whitespace-normal break-all font-mono text-xs">
                  {event.metaJson === null ? "" : JSON.stringify(event.metaJson)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <div className="flex items-center gap-3 text-sm">
        {page > 1 && (
          <Link href={href(page - 1)} className="underline underline-offset-4">
            Newer
          </Link>
        )}
        <span className="text-muted-foreground">
          Page {page} of {pages}
        </span>
        {page < pages && (
          <Link href={href(page + 1)} className="underline underline-offset-4">
            Older
          </Link>
        )}
      </div>
    </div>
  );
}
