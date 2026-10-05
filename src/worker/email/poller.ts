import { db } from "@/lib/db";
import { log } from "../config";
import { PROCESSED_LABEL, REJECTED_LABEL, type Mailbox } from "./mailbox";
import { processMessage } from "./process-message";
import { REASONS } from "./reasons";

const MAX_MESSAGES_PER_POLL = 50;
const STUCK_AFTER_MINUTES = 15;

export function intakeQuery(since: Date) {
  const epoch = Math.floor(since.getTime() / 1000);
  return `after:${epoch} -label:${PROCESSED_LABEL} -label:${REJECTED_LABEL} -in:sent -in:trash`;
}

// Looks for new mail once and handles each message. Returns how many this
// worker handled.
export async function pollMailbox(
  mailbox: Mailbox,
  { since, systemAccount }: { since: Date; systemAccount: string },
) {
  const labels = await mailbox.ensureLabels();
  const refs = await mailbox.listMessages(intakeQuery(since), MAX_MESSAGES_PER_POLL);

  let handled = 0;
  // Oldest first.
  for (const ref of refs.reverse()) {
    if (await processMessage({ mailbox, labels, systemAccount }, ref)) handled += 1;
  }
  return handled;
}

// A worker that died mid-message leaves its row in processing. The message
// gets its Rejected label on the next poll, which still lists it.
export async function failStuckEmails() {
  const { count } = await db.inboundEmail.updateMany({
    where: {
      status: "processing",
      createdAt: { lt: new Date(Date.now() - STUCK_AFTER_MINUTES * 60_000) },
    },
    data: { status: "error", reason: REASONS.timedOut },
  });
  if (count > 0) log(`email: ${count} message(s) timed out in processing`);
}
