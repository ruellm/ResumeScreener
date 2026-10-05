"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  async function onCopy() {
    await navigator.clipboard.writeText(value);
    toast.success("Copied");
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={onCopy}>
      {label}
    </Button>
  );
}
