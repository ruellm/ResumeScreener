"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ActionResult } from "@/lib/action-result";

type IntakeSectionProps = {
  id: string;
  title: string;
  label: string;
  enabled: boolean;
  googleConnected: boolean;
  setEnabled: (input: { enabled: boolean }) => Promise<ActionResult>;
  children?: React.ReactNode;
};

// One on/off switch for a way resumes come in through the Google account.
export function IntakeSection({
  id,
  title,
  label,
  enabled,
  googleConnected,
  setEnabled,
  children,
}: IntakeSectionProps) {
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function onChange(next: boolean) {
    startTransition(async () => {
      const result = await setEnabled({ enabled: next });
      setError(result.ok ? undefined : result.error);
      if (result.ok) toast.success(`${title} is ${next ? "on" : "off"}`);
    });
  }

  return (
    <section className="grid max-w-md gap-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="flex items-center gap-3">
        <Switch
          id={id}
          checked={enabled}
          // Switching off always works, so a broken connection cannot lock it on.
          disabled={pending || (!enabled && !googleConnected)}
          onCheckedChange={onChange}
        />
        <Label htmlFor={id}>{label}</Label>
      </div>
      {!googleConnected && (
        <p className="text-sm text-muted-foreground">
          Connect the Google account below first. Nothing is read while it is disconnected.
        </p>
      )}
      <div className="grid gap-1 text-sm text-muted-foreground">{children}</div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
