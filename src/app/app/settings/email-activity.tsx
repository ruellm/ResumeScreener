import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const STATUS_LABELS: Record<string, string> = {
  processing: "Processing",
  accepted: "Accepted",
  rejected: "Rejected",
  ignored: "Ignored",
  error: "Error",
};

export type EmailActivityRow = {
  id: string;
  received: string;
  from: string | null;
  subject: string | null;
  status: string;
  reason: string | null;
  acceptedCount: number;
  replySent: string | null;
};

export function EmailActivity({ rows }: { rows: EmailActivityRow[] }) {
  return (
    <section className="grid gap-4">
      <h2 className="text-lg font-semibold">Recent email activity</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No emails yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Received</TableHead>
              <TableHead>From</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Accepted</TableHead>
              <TableHead>Reply sent</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.received}</TableCell>
                <TableCell>{row.from}</TableCell>
                <TableCell className="max-w-48 truncate" title={row.subject ?? undefined}>
                  {row.subject}
                </TableCell>
                <TableCell>{STATUS_LABELS[row.status] ?? row.status}</TableCell>
                <TableCell className="max-w-64 whitespace-normal">{row.reason}</TableCell>
                <TableCell>{row.acceptedCount}</TableCell>
                <TableCell>{row.replySent ?? "No"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
