import { CopyButton } from "@/components/copy-button";
import { Badge } from "@/components/ui/badge";
import { jobCode } from "@/lib/job-code";

type JobCodeProps = {
  emailAlias: string;
  // As a badge, for next to a title. Plain text otherwise, for a table cell.
  badge?: boolean;
};

export function JobCode({ emailAlias, badge = false }: JobCodeProps) {
  const code = jobCode(emailAlias);
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      {badge ? (
        <Badge variant="outline" className="font-mono">
          {code}
        </Badge>
      ) : (
        <span className="font-mono text-sm">{code}</span>
      )}
      <CopyButton value={code} compact label={`Copy ${code}`} />
    </span>
  );
}
