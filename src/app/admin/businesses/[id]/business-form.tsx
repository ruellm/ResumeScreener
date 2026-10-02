"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { RetentionConfirmDialog } from "@/components/retention-confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PurgeImpact } from "@/lib/retention";
import { updateBusiness } from "../../actions";

type Values = Record<string, FormDataEntryValue | boolean | null>;

type BusinessFormProps = {
  business: {
    id: string;
    name: string;
    isActive: boolean;
    retentionDays: number | null;
    monthlyEvalLimit: number | null;
    storageLimitMb: number | null;
  };
  retention: { min: number; max: number; default: number };
};

export function BusinessForm({ business, retention }: BusinessFormProps) {
  const [error, setError] = useState<string>();
  // The values waiting for the admin to confirm, with what they would delete.
  const [confirm, setConfirm] = useState<{ values: Values; impact: PurgeImpact }>();
  const [pending, startTransition] = useTransition();

  function save(values: Values, confirmed: boolean) {
    startTransition(async () => {
      const result = await updateBusiness({ ...values, id: business.id, confirmed });
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
      toast.success("Business saved");
    });
  }

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    save(
      {
        name: form.get("name"),
        isActive: form.get("isActive") === "on",
        retentionDays: form.get("retentionDays"),
        monthlyEvalLimit: form.get("monthlyEvalLimit"),
        storageLimitMb: form.get("storageLimitMb"),
      },
      false,
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid max-w-md gap-4">
      <div className="grid gap-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" defaultValue={business.name} required />
      </div>
      <div className="flex items-center gap-2">
        <input
          id="isActive"
          name="isActive"
          type="checkbox"
          defaultChecked={business.isActive}
          className="size-4"
        />
        <Label htmlFor="isActive">Active</Label>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="retentionDays">Retention days</Label>
        <Input
          id="retentionDays"
          name="retentionDays"
          type="number"
          min={retention.min}
          max={retention.max}
          defaultValue={business.retentionDays ?? ""}
          placeholder={`Default (${retention.default})`}
        />
        <p className="text-xs text-muted-foreground">
          Between {retention.min} and {retention.max}. Leave empty to use the default.
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="monthlyEvalLimit">Monthly evaluation limit</Label>
        <Input
          id="monthlyEvalLimit"
          name="monthlyEvalLimit"
          type="number"
          min={1}
          defaultValue={business.monthlyEvalLimit ?? ""}
          placeholder="Unlimited"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="storageLimitMb">Storage limit (MB)</Label>
        <Input
          id="storageLimitMb"
          name="storageLimitMb"
          type="number"
          min={1}
          defaultValue={business.storageLimitMb ?? ""}
          placeholder="Unlimited"
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
