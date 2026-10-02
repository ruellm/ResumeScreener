"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { RetentionConfirmDialog } from "@/components/retention-confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PurgeImpact } from "@/lib/retention";
import { SETTINGS_LIMITS } from "@/lib/settings-schema";
import { updateSettings } from "./actions";

const FIELDS = [
  { name: "defaultRetentionDays", label: "Default retention (days)" },
  { name: "minRetentionDays", label: "Minimum retention (days)" },
  { name: "maxRetentionDays", label: "Maximum retention (days)" },
] as const;

type Values = Record<string, FormDataEntryValue | null>;

type SettingsFormProps = {
  settings: {
    defaultRetentionDays: number;
    minRetentionDays: number;
    maxRetentionDays: number;
    maxFileSizeMb: number;
  };
};

export function SettingsForm({ settings }: SettingsFormProps) {
  const [error, setError] = useState<string>();
  // The values waiting for the admin to confirm, with what they would delete.
  const [confirm, setConfirm] = useState<{ values: Values; impact: PurgeImpact }>();
  const [pending, startTransition] = useTransition();

  function save(values: Values, confirmed: boolean) {
    startTransition(async () => {
      const result = await updateSettings({ ...values, confirmed });
      if (!result.ok) {
        setConfirm(undefined);
        setError(result.error);
        return;
      }
      if (result.confirm) {
        setConfirm({ values, impact: result.confirm });
        return;
      }
      setConfirm(undefined);
      setError(undefined);
      toast.success("Settings saved");
    });
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    save(
      {
        defaultRetentionDays: form.get("defaultRetentionDays"),
        minRetentionDays: form.get("minRetentionDays"),
        maxRetentionDays: form.get("maxRetentionDays"),
        maxFileSizeMb: form.get("maxFileSizeMb"),
      },
      false,
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid max-w-md gap-4">
      {FIELDS.map((field) => (
        <div key={field.name} className="grid gap-2">
          <Label htmlFor={field.name}>{field.label}</Label>
          <Input
            id={field.name}
            name={field.name}
            type="number"
            min={SETTINGS_LIMITS.retentionDaysMin}
            max={SETTINGS_LIMITS.retentionDaysMax}
            defaultValue={settings[field.name]}
            required
          />
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        Between {SETTINGS_LIMITS.retentionDaysMin} and {SETTINGS_LIMITS.retentionDaysMax} days.
        The default must sit between the minimum and the maximum.
      </p>
      <div className="grid gap-2">
        <Label htmlFor="maxFileSizeMb">Maximum file size (MB)</Label>
        <Input
          id="maxFileSizeMb"
          name="maxFileSizeMb"
          type="number"
          min={1}
          max={SETTINGS_LIMITS.fileSizeMbMax}
          defaultValue={settings.maxFileSizeMb}
          required
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving..." : "Save"}
        </Button>
      </div>
      <RetentionConfirmDialog
        impact={confirm?.impact}
        pending={pending}
        onConfirm={() => confirm && save(confirm.values, true)}
        onCancel={() => setConfirm(undefined)}
      />
    </form>
  );
}
