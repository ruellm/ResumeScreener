"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { deleteSubmission } from "../result-actions";

type DeleteSubmissionButtonProps = {
  jobId: string;
  submissionId: string;
  fileName: string;
  size?: "default" | "sm";
  // Where to go afterwards. Without it the current page is reloaded.
  redirectTo?: string;
};

export function DeleteSubmissionButton({
  jobId,
  submissionId,
  fileName,
  size = "default",
  redirectTo,
}: DeleteSubmissionButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      const result = await deleteSubmission({ jobId, submissionId });
      // No result comes back when the action answers with a 404.
      if (result?.ok === false) {
        toast.error(result.error);
        return;
      }
      setOpen(false);
      toast.success("Submission deleted");
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    });
  }

  return (
    <>
      <Button type="button" variant="outline" size={size} onClick={() => setOpen(true)}>
        Delete
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this submission?</DialogTitle>
            <DialogDescription>
              <span className="break-all">{fileName}</span>, its result and its stored files
              are removed. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={pending} onClick={onConfirm}>
              {pending ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
