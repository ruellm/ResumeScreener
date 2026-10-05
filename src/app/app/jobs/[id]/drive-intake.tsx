import { LastCheck } from "./job-intake";

type DriveIntakeProps = {
  enabled: boolean;
  accepting: boolean;
  folderUrl: string | null;
};

export function DriveIntake({ enabled, accepting, folderUrl }: DriveIntakeProps) {
  if (!enabled) {
    return <p className="text-muted-foreground">Google Drive intake is not enabled yet.</p>;
  }
  if (!accepting) {
    return <p className="text-muted-foreground">This job is not accepting resumes.</p>;
  }
  if (!folderUrl) {
    return (
      <p className="text-muted-foreground">
        The folder is being created. Reload this page in a minute.
      </p>
    );
  }

  return (
    <div className="grid gap-2">
      <p>
        <a
          href={folderUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4"
        >
          Open folder in Google Drive
        </a>
      </p>
      <p className="text-sm text-muted-foreground">
        Drop PDF resumes into this folder. Results appear next to each file as _RESULTS.pdf.
      </p>
      <LastCheck kind="drive" />
    </div>
  );
}
