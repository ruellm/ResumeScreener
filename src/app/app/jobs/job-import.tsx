"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ImportedJob } from "@/lib/job-import";
import { blockedSite, blockedSiteMessage } from "@/lib/job-import/blocked-sites";
import { isHttpUrl } from "@/lib/job-schema";
import { importJob } from "./import-actions";

type JobImportProps = {
  busy: boolean;
  onBusy: (busy: boolean) => void;
  // Asked before anything is fetched. False cancels the import.
  confirmReplace: () => boolean;
  onImported: (imported: ImportedJob) => void;
};

// What is shown above the inputs: a plain hint, or something that went wrong.
type Notice = { kind: "info" | "error"; text: string };

// Fills the job form from a job post, by link or from pasted text.
export function JobImport({ busy, onBusy, confirmReplace, onImported }: JobImportProps) {
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<"url" | "text">("url");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [notice, setNotice] = useState<Notice>();
  // The link that could not be imported. Sent along with the pasted text, so
  // the job still points at the original post.
  const [sourceUrl, setSourceUrl] = useState<string>();
  const [focusPaste, setFocusPaste] = useState(false);

  useEffect(() => {
    if (!focusPaste || mode !== "text") return;
    textRef.current?.focus();
    setFocusPaste(false);
  }, [focusPaste, mode]);

  function pasteInstead(next: Notice) {
    const link = url.trim();
    setSourceUrl(isHttpUrl(link) ? link : undefined);
    setNotice(next);
    setMode("text");
    setFocusPaste(true);
  }

  async function extract() {
    if (busy) return;

    // Some sites are known to refuse. Asking the server would only waste time.
    const blocked = mode === "url" ? blockedSite(url) : null;
    if (blocked) {
      pasteInstead({ kind: "info", text: blockedSiteMessage(blocked) });
      return;
    }

    if (!confirmReplace()) return;
    setNotice(undefined);
    onBusy(true);
    try {
      const result = await importJob(mode === "url" ? { url } : { text, sourceUrl });
      // No result comes back when the session ended.
      if (!result) return;
      if (result.ok) {
        onImported(result.imported);
      } else if (result.openPaste) {
        pasteInstead({ kind: blockedSite(url) ? "info" : "error", text: result.error });
      } else {
        setNotice({ kind: "error", text: result.error });
      }
    } catch {
      setNotice({
        kind: "error",
        text: "The import did not work. Try again or fill in the form manually.",
      });
    } finally {
      onBusy(false);
    }
  }

  const spinner = busy && <Loader2Icon className="animate-spin" aria-hidden />;

  return (
    <section className="grid gap-3 rounded-lg border p-4">
      <h2 className="font-medium">Import from a job post</h2>

      {notice?.kind === "info" && (
        <p role="status" className="rounded-md border bg-muted/50 p-3 text-sm">
          {notice.text}
        </p>
      )}
      {notice?.kind === "error" && (
        <p role="alert" className="text-sm text-destructive">
          {notice.text}
        </p>
      )}

      {mode === "url" ? (
        <div className="grid gap-2">
          <Label htmlFor="import-url">Link to the job post</Label>
          <div className="flex gap-2">
            <Input
              id="import-url"
              type="url"
              placeholder="https://"
              value={url}
              disabled={busy}
              onChange={(event) => {
                setUrl(event.target.value);
                setSourceUrl(undefined);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void extract();
                }
              }}
            />
            <Button type="button" disabled={busy || url.trim() === ""} onClick={extract}>
              {spinner}
              {busy ? "Extracting..." : "Extract"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-2">
          <Label htmlFor="import-text">Job description</Label>
          <Textarea
            ref={textRef}
            id="import-text"
            rows={8}
            placeholder="Paste the full text of the job post here."
            value={text}
            disabled={busy}
            onChange={(event) => setText(event.target.value)}
          />
          {sourceUrl && (
            <p className="break-all text-xs text-muted-foreground">
              The job will keep its link to {sourceUrl}
            </p>
          )}
          <div>
            <Button type="button" disabled={busy || text.trim() === ""} onClick={extract}>
              {spinner}
              {busy ? "Extracting..." : "Extract from text"}
            </Button>
          </div>
        </div>
      )}

      <div>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setNotice(undefined);
            setMode(mode === "url" ? "text" : "url");
          }}
          className="text-sm underline underline-offset-4 disabled:opacity-50"
        >
          {mode === "url" ? "Paste the job description instead" : "Use a link instead"}
        </button>
      </div>
    </section>
  );
}
