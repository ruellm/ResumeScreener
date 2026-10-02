"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateBusiness } from "../../actions";

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
  const [pending, startTransition] = useTransition();

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await updateBusiness({
        id: business.id,
        name: form.get("name"),
        isActive: form.get("isActive") === "on",
        retentionDays: form.get("retentionDays"),
        monthlyEvalLimit: form.get("monthlyEvalLimit"),
        storageLimitMb: form.get("storageLimitMb"),
      });
      if (result.ok) {
        setError(undefined);
        toast.success("Business saved");
      } else {
        setError(result.error);
      }
    });
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
    </form>
  );
}
