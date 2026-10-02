"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { VerdictBadge } from "@/components/verdict-badge";
import { formatDateTime } from "@/lib/format";
import { RESUMES_BUCKET } from "@/lib/storage-keys";
import { createClient } from "@/lib/supabase/client";
import {
  fileError,
  JOB_CLOSED_MESSAGE,
  MAX_FILES_PER_BATCH,
  SUBMISSION_STATUS_LABELS,
  type PreparedFile,
  type SubmissionStatusRow,
} from "@/lib/uploads";
import { cn } from "@/lib/utils";
import { confirmUpload, prepareUploads } from "../upload-actions";
import { useShowTab } from "./job-tabs";

const PARALLEL_UPLOADS = 3;
const POLL_MS = 3000;
const STATUS_IDS_PER_REQUEST = 100;

type Phase =
  | "preparing"
  | "duplicate"
  | "skipped"
  | "uploading"
  | "uploaded"
  | "tracking"
  | "error";

// A file picked on this visit. It has a submission once prepareUploads made one.
type Item = {
  key: string;
  name: string;
  phase: Phase;
  error?: string;
  submissionId?: string;
};

type Entry = { key: string; file: File; sha256: string };
type Duplicate = { entry: Entry; existingSubmissionId: string; existingDate: string };
type ReadyUpload = { entry: Entry } & Extract<PreparedFile, { status: "ready" }>;

type ListRow = {
  key: string;
  name: string;
  status: string;
  error?: string | null;
  server?: SubmissionStatusRow;
};

const PHASE_LABELS: Record<Exclude<Phase, "tracking">, string> = {
  preparing: "Preparing",
  duplicate: "Duplicate",
  skipped: "Skipped (duplicate)",
  uploading: "Uploading",
  uploaded: "Uploaded",
  error: "Failed",
};

function inProgress(row: SubmissionStatusRow | undefined) {
  return row?.status !== "DONE" && row?.status !== "FAILED";
}

async function sha256Hex(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type EvaluateTabProps = {
  jobId: string;
  // False for a closed or archived job: the list shows, the upload area does not.
  active: boolean;
  maxFileSizeMb: number;
  // Only passed when the business has a monthly limit.
  usage?: { used: number; limit: number };
  // The job's latest submissions when the page was loaded, newest first.
  recent: SubmissionStatusRow[];
};

export function EvaluateTab({ jobId, active, maxFileSizeMb, usage, recent }: EvaluateTabProps) {
  const router = useRouter();
  const showTab = useShowTab();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  // The list is seeded once from the page load. After that polling keeps it
  // current, so a later refresh of the page data does not reshuffle it.
  const [recentIds] = useState(() => recent.map((row) => row.id));
  const [statuses, setStatuses] = useState(() => new Map(recent.map((row) => [row.id, row])));
  const [duplicates, setDuplicates] = useState<Duplicate[]>([]);
  const [notice, setNotice] = useState<string>();
  const [dragging, setDragging] = useState(false);

  function patch(key: string, changes: Partial<Item>) {
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...changes } : item)),
    );
  }

  async function uploadAndConfirm(ready: ReadyUpload[]) {
    if (ready.length === 0) return;
    const bucket = createClient().storage.from(RESUMES_BUCKET);

    let next = 0;
    async function uploadNext() {
      while (next < ready.length) {
        const upload = ready[next++];
        const { error } = await bucket.uploadToSignedUrl(
          upload.path,
          upload.token,
          upload.entry.file,
          { contentType: "application/pdf" },
        );
        patch(
          upload.entry.key,
          error ? { phase: "error", error: "The upload failed. Try again." } : { phase: "uploaded" },
        );
      }
    }
    await Promise.all(Array.from({ length: PARALLEL_UPLOADS }, uploadNext));

    // Failed uploads are sent too: confirming them removes their rows, so a
    // retry is not reported as a duplicate.
    const result = await confirmUpload({
      jobId,
      submissionIds: ready.map((upload) => upload.submissionId),
    });
    for (const upload of ready) {
      const confirmed = result?.ok
        ? result.results.find((row) => row.submissionId === upload.submissionId)
        : undefined;
      if (confirmed?.ok) {
        patch(upload.entry.key, { phase: "tracking", error: undefined });
      } else {
        setItems((current) =>
          current.map((item) =>
            item.key === upload.entry.key && item.phase !== "error"
              ? {
                  ...item,
                  phase: "error",
                  error: confirmed?.error ?? "The upload could not be confirmed. Try again.",
                }
              : item,
          ),
        );
      }
    }
  }

  async function prepareAndUpload(entries: Entry[], allowDuplicate: boolean) {
    const result = await prepareUploads({
      jobId,
      files: entries.map(({ file, sha256 }) => ({
        name: file.name,
        size: file.size,
        sha256,
        allowDuplicate,
      })),
    });
    if (!result?.ok) {
      const error = result?.error ?? "Could not prepare the upload. Try again.";
      setNotice(error);
      entries.forEach((entry) => patch(entry.key, { phase: "error", error }));
      return;
    }

    const ready: ReadyUpload[] = [];
    const found: Duplicate[] = [];
    result.files.forEach((file, index) => {
      const entry = entries[index];
      if (file.status === "ready") {
        ready.push({ entry, ...file });
        patch(entry.key, { phase: "uploading", submissionId: file.submissionId });
      } else if (file.status === "duplicate") {
        found.push({
          entry,
          existingSubmissionId: file.existingSubmissionId,
          existingDate: file.existingDate,
        });
        patch(entry.key, { phase: "duplicate" });
      } else {
        patch(entry.key, { phase: "error", error: file.error });
      }
    });
    if (found.length > 0) setDuplicates((current) => [...current, ...found]);
    await uploadAndConfirm(ready);
  }

  async function addFiles(selected: File[]) {
    if (selected.length === 0) return;
    setNotice(
      selected.length > MAX_FILES_PER_BATCH
        ? `Only the first ${MAX_FILES_PER_BATCH} files were added. Add the rest as another batch.`
        : undefined,
    );

    const batch = selected.slice(0, MAX_FILES_PER_BATCH).map((file) => ({
      key: crypto.randomUUID(),
      file,
      error: fileError(file.name, file.size, maxFileSizeMb),
    }));
    setItems((current) => [
      ...batch.map(
        ({ key, file, error }): Item =>
          error
            ? { key, name: file.name, phase: "error", error }
            : { key, name: file.name, phase: "preparing" },
      ),
      ...current,
    ]);

    // One at a time, so a large batch is not held in memory all at once.
    const entries: Entry[] = [];
    for (const { key, file, error } of batch) {
      if (!error) entries.push({ key, file, sha256: await sha256Hex(file) });
    }
    if (entries.length > 0) await prepareAndUpload(entries, false);
  }

  function skipDuplicates() {
    duplicates.forEach(({ entry }) => patch(entry.key, { phase: "skipped" }));
    setDuplicates([]);
  }

  function evaluateDuplicates() {
    const entries = duplicates.map(({ entry }) => entry);
    entries.forEach((entry) => patch(entry.key, { phase: "preparing" }));
    setDuplicates([]);
    void prepareAndUpload(entries, true);
  }

  // This visit's files first, then the earlier submissions that are not
  // already shown as one of them.
  const visitIds = new Set(items.map((item) => item.submissionId));
  const rows: ListRow[] = [
    ...items.map((item): ListRow => {
      const server =
        item.phase === "tracking" && item.submissionId
          ? statuses.get(item.submissionId)
          : undefined;
      return {
        key: item.key,
        name: item.name,
        status:
          item.phase === "tracking"
            ? SUBMISSION_STATUS_LABELS[server?.status ?? "QUEUED"]
            : PHASE_LABELS[item.phase],
        error: server?.status === "FAILED" ? server.error : item.error,
        server,
      };
    }),
    ...recentIds.flatMap((id): ListRow[] => {
      const server = statuses.get(id);
      if (!server || visitIds.has(id)) return [];
      return [
        {
          key: id,
          name: server.originalFilename,
          status: SUBMISSION_STATUS_LABELS[server.status],
          error: server.status === "FAILED" ? server.error : null,
          server,
        },
      ];
    }),
  ];

  const pendingIds = [
    ...items.flatMap((item) =>
      item.phase === "tracking" && item.submissionId && inProgress(statuses.get(item.submissionId))
        ? [item.submissionId]
        : [],
    ),
    ...recentIds.filter((id) => !visitIds.has(id) && inProgress(statuses.get(id))),
  ].join(",");

  useEffect(() => {
    if (!pendingIds) return;
    const ids = pendingIds.split(",");

    const timer = setInterval(async () => {
      const fetched: SubmissionStatusRow[] = [];
      for (let start = 0; start < ids.length; start += STATUS_IDS_PER_REQUEST) {
        const chunk = ids.slice(start, start + STATUS_IDS_PER_REQUEST);
        const response = await fetch(`/api/jobs/${jobId}/submissions?ids=${chunk.join(",")}`);
        // A redirect means the session ended and the login page came back.
        if (!response.ok || response.redirected) return;
        fetched.push(...((await response.json()) as SubmissionStatusRow[]));
      }
      setStatuses((current) => {
        const next = new Map(current);
        fetched.forEach((row) => next.set(row.id, row));
        return next;
      });
      // Finished evaluations change the monthly usage shown above.
      if (fetched.some((row) => row.status === "DONE")) router.refresh();
    }, POLL_MS);

    return () => clearInterval(timer);
  }, [pendingIds, jobId, router]);

  return (
    <div className="grid gap-6">
      {!active && <p className="text-muted-foreground">{JOB_CLOSED_MESSAGE}</p>}

      {active && usage && (
        <p className="text-sm text-muted-foreground">
          {usage.used} of {usage.limit} evaluations used this month.
        </p>
      )}

      {active && (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void addFiles(Array.from(event.dataTransfer.files));
          }}
          className={cn(
            "grid justify-items-center gap-2 rounded-lg border border-dashed p-8 text-center",
            dragging && "bg-muted",
          )}
        >
          <p className="font-medium">Drop PDF resumes here</p>
          <p className="text-xs text-muted-foreground">
            Up to {MAX_FILES_PER_BATCH} files at a time, {maxFileSizeMb} MB each.
          </p>
          <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
            Choose files
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={(event) => {
              void addFiles(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
        </div>
      )}

      {notice && (
        <p role="alert" className="text-sm text-destructive">
          {notice}
        </p>
      )}

      <section className="grid gap-2">
        <h2 className="font-medium">Recent submissions</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No submissions yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Candidate</TableHead>
                <TableHead>Verdict</TableHead>
                <TableHead>Score</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ key, name, status, error, server }) => (
                <TableRow key={key}>
                  <TableCell className="whitespace-normal">
                    {server?.status === "DONE" ? (
                      <Link
                        href={`/app/jobs/${jobId}/results/${server.id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {name}
                      </Link>
                    ) : (
                      name
                    )}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {status}
                    {error && <span className="block text-xs text-destructive">{error}</span>}
                  </TableCell>
                  <TableCell>{server?.candidateName}</TableCell>
                  <TableCell>
                    {server?.verdict && (
                      <VerdictBadge verdict={server.verdict} rejected={server.rejected} />
                    )}
                  </TableCell>
                  <TableCell>{server?.score}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div>
          <a
            href="?tab=dashboard"
            onClick={(event) => {
              event.preventDefault();
              showTab("dashboard");
            }}
            className="text-sm underline underline-offset-4"
          >
            View all in Dashboard
          </a>
        </div>
      </section>

      <Dialog
        open={duplicates.length > 0}
        onOpenChange={(open) => {
          if (!open) skipDuplicates();
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Already submitted</DialogTitle>
            <DialogDescription>
              These files were submitted to this job before.
            </DialogDescription>
          </DialogHeader>
          <ul className="grid gap-2 text-sm">
            {duplicates.map(({ entry, existingSubmissionId, existingDate }) => (
              <li key={entry.key} className="grid gap-0.5">
                <span className="break-all">{entry.file.name}</span>
                <span className="flex flex-wrap gap-3 text-muted-foreground">
                  {formatDateTime(new Date(existingDate))}
                  <a
                    href={`/app/jobs/${jobId}/results/${existingSubmissionId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-4"
                  >
                    View result
                  </a>
                </span>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={skipDuplicates}>
              Skip duplicates
            </Button>
            <Button type="button" onClick={evaluateDuplicates}>
              Evaluate again
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
