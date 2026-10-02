"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PurgeImpact } from "@/lib/retention";

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

type RetentionConfirmDialogProps = {
  // Shown while set.
  impact: PurgeImpact | undefined;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function RetentionConfirmDialog({
  impact,
  pending,
  onConfirm,
  onCancel,
}: RetentionConfirmDialogProps) {
  return (
    <Dialog
      open={impact !== undefined}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Shorten retention?</DialogTitle>
          <DialogDescription>
            {impact &&
              `${plural(impact.submissions, "submission", "submissions")} across ` +
                `${plural(impact.businesses, "business", "businesses")} will be deleted at the next purge.`}{" "}
            This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" disabled={pending} onClick={onConfirm}>
            {pending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
