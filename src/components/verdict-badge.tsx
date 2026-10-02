import type { Verdict } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { verdictLabel } from "@/lib/evaluation-result";

const VARIANTS = {
  PASS: "default",
  MAYBE: "secondary",
  FAIL: "destructive",
} as const;

// rejected: failed for trying to instruct the screener, shown as Rejected.
export function VerdictBadge({ verdict, rejected = false }: { verdict: Verdict; rejected?: boolean }) {
  return <Badge variant={VARIANTS[verdict]}>{verdictLabel(verdict, rejected)}</Badge>;
}
