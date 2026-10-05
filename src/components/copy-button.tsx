"use client";

import { CopyIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type CopyButtonProps = {
  value: string;
  label?: string;
  // A small icon only. The label is then what screen readers and the tooltip say.
  compact?: boolean;
};

export function CopyButton({ value, label = "Copy", compact = false }: CopyButtonProps) {
  async function onCopy() {
    await navigator.clipboard.writeText(value);
    toast.success("Copied");
  }

  if (compact) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={label}
        title={label}
        onClick={onCopy}
      >
        <CopyIcon />
      </Button>
    );
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={onCopy}>
      {label}
    </Button>
  );
}
