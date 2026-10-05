import type { Auth } from "googleapis";
import { db } from "@/lib/db";
import { serverEnv } from "@/lib/env.server";
import { GOOGLE_CONNECTION_ID } from "@/lib/google/oauth";
import { getSystemAuth, GoogleNotConnectedError } from "@/lib/google/system-auth";
import { log, workerEnv } from "../config";
import { createMailbox, type Mailbox } from "./mailbox";
import { pollMailbox } from "./poller";
import { dueReplies, sendReply } from "./reply";

const REPLY_CHECK_MS = 15_000;

let lastPoll = 0;
let lastReplyCheck = 0;
let notConnectedLogged = false;
let task: Promise<void> | null = null;
// Kept with its client, so the label ids are looked up once.
let current: { auth: Auth.OAuth2Client; mailbox: Mailbox } | undefined;

function describe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function notConnected() {
  if (!notConnectedLogged) log("email: Google account not connected, mail is not checked");
  notConnectedLogged = true;
}

async function systemMailbox() {
  const auth = await getSystemAuth();
  if (current?.auth !== auth) current = { auth, mailbox: createMailbox(auth) };
  return current.mailbox;
}

async function run(pollDue: boolean) {
  const [settings, connection] = await Promise.all([
    db.settings.findUniqueOrThrow({
      where: { id: 1 },
      select: { emailIntakeEnabled: true, emailIntakeSince: true },
    }),
    db.googleConnection.findUnique({
      where: { id: GOOGLE_CONNECTION_ID },
      select: { status: true },
    }),
  ]);
  if (connection?.status !== "ok") {
    notConnected();
    return;
  }
  if (notConnectedLogged) log("email: Google account connected again");
  notConnectedLogged = false;

  // Replies still go out for mail taken in before intake was switched off.
  const replies = await dueReplies();
  const poll = pollDue && settings.emailIntakeEnabled && settings.emailIntakeSince !== null;
  if (replies.length === 0 && !poll) return;

  const mailbox = await systemMailbox();
  for (const id of replies) await sendReply(mailbox, id);
  if (poll) {
    await pollMailbox(mailbox, {
      since: settings.emailIntakeSince!,
      systemAccount: serverEnv.GOOGLE_SYSTEM_ACCOUNT,
    });
  }
}

// Runs beside the queue, like the purge. Does nothing while a run is going.
export function checkEmail() {
  const now = Date.now();
  const pollDue = now - lastPoll >= workerEnv.EMAIL_POLL_MS;
  if (task || (!pollDue && now - lastReplyCheck < REPLY_CHECK_MS)) return;
  lastReplyCheck = now;
  if (pollDue) lastPoll = now;

  task = run(pollDue)
    .catch((error) => {
      if (error instanceof GoogleNotConnectedError) notConnected();
      else log(`email error: ${describe(error)}`);
    })
    .finally(() => {
      task = null;
    });
}

export function emailTask() {
  return task;
}
