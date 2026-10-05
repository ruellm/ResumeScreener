import { Readable } from "node:stream";
import { google, type Auth } from "googleapis";

export const PROCESSED_LABEL = "Screener/Processed";
export const REJECTED_LABEL = "Screener/Rejected";

export type MailPart = {
  mimeType?: string | null;
  filename?: string | null;
  headers?: { name?: string | null; value?: string | null }[] | null;
  body?: { attachmentId?: string | null; size?: number | null; data?: string | null } | null;
  parts?: MailPart[] | null;
};

export type MailMessage = {
  id: string;
  threadId: string;
  // Milliseconds since 1970, as text.
  internalDate?: string | null;
  payload?: MailPart | null;
};

export type MessageRef = { id: string; threadId: string };

export type Labels = { processed: string; rejected: string };

// The few Gmail calls the worker needs. Tests swap in a fake.
export type Mailbox = {
  ensureLabels(): Promise<Labels>;
  // Newest first, as Gmail lists them.
  listMessages(query: string, max: number): Promise<MessageRef[]>;
  getMessage(id: string): Promise<MailMessage>;
  getAttachment(messageId: string, attachmentId: string): Promise<Buffer>;
  modifyMessage(id: string, change: { add?: string[]; remove?: string[] }): Promise<void>;
  send(raw: Buffer, threadId: string): Promise<void>;
};

const PAGE_SIZE = 50;
const USER = "me";

export function createMailbox(auth: Auth.OAuth2Client): Mailbox {
  const gmail = google.gmail({ version: "v1", auth });
  let labels: Labels | undefined;

  async function labelId(name: string, existing: Map<string, string>) {
    const known = existing.get(name);
    if (known) return known;
    const created = await gmail.users.labels.create({
      userId: USER,
      requestBody: { name, labelListVisibility: "labelShow", messageListVisibility: "show" },
    });
    if (!created.data.id) throw new Error(`Label ${name} was not created.`);
    return created.data.id;
  }

  return {
    async ensureLabels() {
      if (labels) return labels;
      const list = await gmail.users.labels.list({ userId: USER });
      const existing = new Map(
        (list.data.labels ?? []).flatMap((label) =>
          label.name && label.id ? [[label.name, label.id] as const] : [],
        ),
      );
      labels = {
        processed: await labelId(PROCESSED_LABEL, existing),
        rejected: await labelId(REJECTED_LABEL, existing),
      };
      return labels;
    },

    async listMessages(query, max) {
      const ids: MessageRef[] = [];
      let pageToken: string | undefined;
      do {
        const page = await gmail.users.messages.list({
          userId: USER,
          q: query,
          includeSpamTrash: true,
          maxResults: Math.min(PAGE_SIZE, max - ids.length),
          pageToken,
        });
        for (const message of page.data.messages ?? []) {
          if (message.id && message.threadId && ids.length < max) {
            ids.push({ id: message.id, threadId: message.threadId });
          }
        }
        pageToken = page.data.nextPageToken ?? undefined;
      } while (pageToken && ids.length < max);
      return ids;
    },

    async getMessage(id) {
      const { data } = await gmail.users.messages.get({ userId: USER, id, format: "full" });
      if (!data.id || !data.threadId) throw new Error(`Message ${id} came back without an id.`);
      return { ...data, id: data.id, threadId: data.threadId };
    },

    async getAttachment(messageId, attachmentId) {
      const { data } = await gmail.users.messages.attachments.get({
        userId: USER,
        messageId,
        id: attachmentId,
      });
      return Buffer.from(data.data ?? "", "base64url");
    },

    async modifyMessage(id, { add = [], remove = [] }) {
      await gmail.users.messages.modify({
        userId: USER,
        id,
        requestBody: { addLabelIds: add, removeLabelIds: remove },
      });
    },

    // Sent as an upload: the plain JSON form is too small for result PDFs.
    // The upload takes text or a stream, and text would damage the bytes.
    async send(raw, threadId) {
      await gmail.users.messages.send({
        userId: USER,
        requestBody: { threadId },
        media: { mimeType: "message/rfc822", body: Readable.from([raw]) },
      });
    },
  };
}
