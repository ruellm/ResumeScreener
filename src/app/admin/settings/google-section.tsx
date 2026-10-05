import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { GoogleControls } from "./google-controls";

const CONNECT_URL = "/api/admin/google/connect";

type GoogleSectionProps = {
  connection: {
    email: string;
    status: string;
    lastError: string | null;
    connectedAt: Date;
    lastUsedAt: Date | null;
  } | null;
  // Set by the callback redirect.
  message?: string;
  error?: string;
};

export function GoogleSection({ connection, message, error }: GoogleSectionProps) {
  return (
    <section className="grid max-w-md gap-4">
      <h2 className="text-lg font-semibold">Google account</h2>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {connection ? (
        <>
          {connection.status === "error" && (
            <div
              role="alert"
              className="grid gap-1 rounded-md border border-destructive p-3 text-sm text-destructive"
            >
              <p className="font-medium">The connection is broken. Reconnect the account.</p>
              {connection.lastError && <p>{connection.lastError}</p>}
            </div>
          )}
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Email</dt>
            <dd>{connection.email}</dd>
            <dt className="text-muted-foreground">Status</dt>
            <dd>{connection.status === "ok" ? "OK" : "Error"}</dd>
            <dt className="text-muted-foreground">Connected at</dt>
            <dd>{formatDateTime(connection.connectedAt)}</dd>
            <dt className="text-muted-foreground">Last used</dt>
            <dd>{connection.lastUsedAt ? formatDateTime(connection.lastUsedAt) : "Never"}</dd>
          </dl>
          <GoogleControls connectUrl={CONNECT_URL} />
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">Not connected</p>
          <div>
            <Button asChild>
              {/* Not a Link: this is a route that redirects to Google. */}
              <a href={CONNECT_URL}>Connect</a>
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
