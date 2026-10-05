import Link from "next/link";
import { CopyButton } from "@/components/copy-button";
import { LastCheck } from "./job-intake";

type EmailIntakeProps = {
  // The admin switch. The address is shown either way, so it can be handed out early.
  enabled: boolean;
  accepting: boolean;
  address: string;
  mailbox: string;
  subjectCode: string;
  maxFileSizeMb: number;
  hasSenders: boolean;
};

export function EmailIntake({
  enabled,
  accepting,
  address,
  mailbox,
  subjectCode,
  maxFileSizeMb,
  hasSenders,
}: EmailIntakeProps) {
  if (!accepting) {
    return <p className="text-muted-foreground">This job is not accepting resumes.</p>;
  }

  return (
    <div className="grid gap-2">
      {!hasSenders && (
        <p role="alert" className="rounded-md border border-destructive p-3 text-sm">
          No allowed senders yet. Emails will be ignored until you add some in{" "}
          <Link href="/app/settings" className="underline underline-offset-4">
            Settings
          </Link>
          .
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="break-all font-mono text-sm">{address}</span>
        <CopyButton value={address} />
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>
          Or send to <span className="break-all font-mono">{mailbox}</span>
        </span>
        <CopyButton value={mailbox} />
        <span>
          with <span className="font-mono">{subjectCode}</span> in the subject
        </span>
        <CopyButton value={subjectCode} />
      </div>
      <p className="text-sm text-muted-foreground">
        Attach PDF resumes, up to {maxFileSizeMb} MB each. Results are emailed back to the
        sender.
      </p>
      {enabled ? (
        <LastCheck kind="email" />
      ) : (
        <p className="text-sm text-muted-foreground">Email intake is not enabled yet.</p>
      )}
    </div>
  );
}
