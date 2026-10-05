"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { setEmailIntake } from "./actions";

type EmailIntakeSectionProps = {
  enabled: boolean;
  // When intake was first switched on. Older mail is never read.
  since: string | null;
  googleConnected: boolean;
};

export function EmailIntakeSection({ enabled, since, googleConnected }: EmailIntakeSectionProps) {
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function onChange(next: boolean) {
    startTransition(async () => {
      const result = await setEmailIntake({ enabled: next });
      setError(result.ok ? undefined : result.error);
      if (result.ok) toast.success(next ? "Email intake is on" : "Email intake is off");
    });
  }

  return (
    <section className="grid max-w-md gap-3">
      <h2 className="text-lg font-semibold">Email intake</h2>
      <div className="flex items-center gap-3">
        <Switch
          id="email-intake"
          checked={enabled}
          // Switching off always works, so a broken connection cannot lock it on.
          disabled={pending || (!enabled && !googleConnected)}
          onCheckedChange={onChange}
        />
        <Label htmlFor="email-intake">Read resumes sent by email</Label>
      </div>
      {!googleConnected && (
        <p className="text-sm text-muted-foreground">
          Connect the Google account below first. Mail is not checked while it is disconnected.
        </p>
      )}
      {since && (
        <p className="text-sm text-muted-foreground">Mail received before {since} is not read.</p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
