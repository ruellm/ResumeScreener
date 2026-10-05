"use client";

import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { addAllowedSender, removeAllowedSender } from "./actions";

type SenderRow = {
  id: string;
  display: string;
  kind: string;
  addedBy: string | null;
  addedOn: string;
};

export function SendersSection({ senders, max }: { senders: SenderRow[]; max: number }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function onAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await addAllowedSender({ entry: form.get("entry") });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(undefined);
      formRef.current?.reset();
    });
  }

  function onRemove(id: string) {
    startTransition(async () => {
      const result = await removeAllowedSender({ id });
      if (!result.ok) toast.error(result.error);
    });
  }

  return (
    <section className="grid gap-4">
      <h2 className="text-lg font-semibold">Allowed senders</h2>

      {senders.length === 0 ? (
        <p className="text-sm text-muted-foreground">No allowed senders yet.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Entry</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Added by</TableHead>
              <TableHead>Added on</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {senders.map((sender) => (
              <TableRow key={sender.id}>
                <TableCell>{sender.display}</TableCell>
                <TableCell>{sender.kind === "domain" ? "Domain" : "Email"}</TableCell>
                <TableCell>{sender.addedBy ?? "Unknown"}</TableCell>
                <TableCell>{sender.addedOn}</TableCell>
                <TableCell>
                  <div className="flex justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() => onRemove(sender.id)}
                    >
                      Remove
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <div className="grid gap-1 text-sm text-muted-foreground">
        <p>Only these senders can email resumes to your jobs.</p>
        <p>
          Domain entries apply to email only. Google Drive folders are shared with individual
          email addresses.
        </p>
        <p>
          Drive access needs a Google account. Any work email can be used to create one at
          accounts.google.com, no Gmail address needed.
        </p>
      </div>

      <form ref={formRef} onSubmit={onAdd} className="grid max-w-md gap-2">
        <Label htmlFor="sender-entry">Add an email address or a domain</Label>
        <div className="flex gap-2">
          <Input
            id="sender-entry"
            name="entry"
            placeholder="name@lintech.com or lintech.com"
            maxLength={320}
            required
          />
          <Button type="submit" disabled={pending}>
            {pending ? "Adding..." : "Add"}
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          A domain allows every address at exactly that domain. Subdomains are not included. Up
          to {max} entries.
        </p>
      </form>
    </section>
  );
}
