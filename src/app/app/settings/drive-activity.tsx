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
  skipped: "Skipped",
  error: "Error",
};

export type DriveActivityRow = {
  id: string;
  seen: string;
  fileName: string;
  uploader: string | null;
  job: string | null;
  status: string;
  reason: string | null;
};

type GoogleDriveSectionProps = {
  enabled: boolean;
  folderUrl: string | null;
  rows: DriveActivityRow[];
};

export function GoogleDriveSection({ enabled, folderUrl, rows }: GoogleDriveSectionProps) {
  return (
    <section className="grid gap-4">
      <h2 className="text-lg font-semibold">Google Drive</h2>
      {!enabled ? (
        <p className="text-sm text-muted-foreground">Google Drive intake is not enabled yet.</p>
      ) : folderUrl ? (
        <p className="text-sm">
          <a
            href={folderUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4"
          >
            Open your folder in Google Drive
          </a>
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Your folder is created with your first job. It can take a minute to appear.
        </p>
      )}

      <h3 className="font-medium">Recent Drive activity</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No files yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Seen</TableHead>
              <TableHead>File</TableHead>
              <TableHead>Uploaded by</TableHead>
              <TableHead>Job</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>{row.seen}</TableCell>
                <TableCell className="max-w-48 truncate" title={row.fileName}>
                  {row.fileName}
                </TableCell>
                <TableCell>{row.uploader}</TableCell>
                <TableCell className="max-w-48 truncate" title={row.job ?? undefined}>
                  {row.job}
                </TableCell>
                <TableCell>{STATUS_LABELS[row.status] ?? row.status}</TableCell>
                <TableCell className="max-w-64 whitespace-normal">{row.reason}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
