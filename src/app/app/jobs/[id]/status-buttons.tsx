"use client";

import { useTransition } from "react";
import type { JobStatus } from "@prisma/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { JOB_STATUS_ACTIONS } from "@/lib/job-status";
import { setJobStatus } from "../actions";

export function StatusButtons({ jobId, status }: { jobId: string; status: JobStatus }) {
  const [pending, startTransition] = useTransition();

  function onChange(to: JobStatus) {
    startTransition(async () => {
      const result = await setJobStatus({ id: jobId, status: to });
      // No result comes back when the action answers with a 404.
      if (result?.ok === false) toast.error(result.error);
    });
  }

  return (
    <>
      {JOB_STATUS_ACTIONS[status].map((action) => (
        <Button
          key={action.to}
          variant="outline"
          disabled={pending}
          onClick={() => onChange(action.to)}
        >
          {action.label}
        </Button>
      ))}
    </>
  );
}
