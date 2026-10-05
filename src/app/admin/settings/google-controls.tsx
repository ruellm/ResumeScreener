"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format";
import type { GoogleTestResult } from "@/lib/google/connect";
import { disconnectGoogle, testGoogleConnection } from "./actions";

export function GoogleControls({ connectUrl }: { connectUrl: string }) {
  const [result, setResult] = useState<GoogleTestResult>();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function test() {
    startTransition(async () => {
      const response = await testGoogleConnection();
      setResult(response.ok ? response.result : undefined);
      setError(response.ok ? undefined : response.error);
    });
  }

  function disconnect() {
    if (!window.confirm("Disconnect the Google account? Email and Drive intake will stop.")) {
      return;
    }
    startTransition(async () => {
      const response = await disconnectGoogle();
      if (!response.ok) {
        setError(response.error);
        return;
      }
      toast.success("Google account disconnected");
    });
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={pending} onClick={test}>
          Test connection
        </Button>
        <Button asChild variant="outline">
          <a href={connectUrl}>Reconnect</a>
        </Button>
        <Button type="button" variant="destructive" disabled={pending} onClick={disconnect}>
          Disconnect
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {result && (
        <div className="grid gap-1 text-sm">
          <p>
            Gmail: {result.gmail.address}, {result.gmail.messagesTotal} messages
          </p>
          <p>
            Drive: {result.drive.email}, {formatBytes(result.drive.storageUsedBytes)} used of{" "}
            {result.drive.storageLimitBytes === null
              ? "unlimited"
              : formatBytes(result.drive.storageLimitBytes)}
          </p>
        </div>
      )}
    </div>
  );
}
