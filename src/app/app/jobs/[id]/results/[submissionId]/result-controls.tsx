"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { reevaluateSubmission } from "../../../result-actions";

export function ReevaluateButton({
  jobId,
  submissionId,
}: {
  jobId: string;
  submissionId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      const result = await reevaluateSubmission({ jobId, submissionId });
      // No result comes back when the action answers with a 404.
      if (result?.ok === false) toast.error(result.error);
      else router.refresh();
    });
  }

  return (
    <Button type="button" variant="outline" disabled={pending} onClick={onClick}>
      {pending ? "Queueing..." : "Re-evaluate"}
    </Button>
  );
}
