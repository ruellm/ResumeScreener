import "server-only";
import { Readable } from "node:stream";
import { google, type Auth } from "googleapis";
import { getSystemAuth, GoogleNotConnectedError } from "./system-auth";

export const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

// What a file we created is, stored on the file as appProperties.screener.
export type OwnFileKind = "result" | "note" | "folder";

export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  // Missing for Google Docs and folders.
  size: number | null;
  trashed: boolean;
  parents: string[];
  ownerEmail: string | null;
  lastModifierEmail: string | null;
  appProperties: Record<string, string>;
};

export type DrivePermission = {
  id: string;
  // "user", "group", "domain" or "anyone"
  type: string;
  role: string;
  emailAddress: string | null;
  domain: string | null;
  // null when Google does not say.
  inherited: boolean | null;
};

export type DriveChange = { fileId: string; removed: boolean; file: DriveFile | null };

export type DriveChangePage = {
  changes: DriveChange[];
  // Set while there are more pages.
  nextPageToken: string | null;
  // Set on the last page: where the next poll starts.
  newStartPageToken: string | null;
};

type NewFile = {
  name: string;
  parentId: string;
  mimeType: string;
  content: Buffer;
  kind: OwnFileKind;
  // Extra appProperties, used to find the file again.
  tags?: Record<string, string>;
};

// The Drive calls the app needs. Tests swap in a fake.
export type DriveClient = {
  createFolder(name: string, parentId: string | null): Promise<string>;
  getFile(fileId: string): Promise<DriveFile>;
  rename(fileId: string, name: string): Promise<void>;
  listPermissions(fileId: string): Promise<DrivePermission[]>;
  // Shares with one person as a writer and emails them the message.
  shareWithUser(fileId: string, email: string, message: string): Promise<string>;
  deletePermission(fileId: string, permissionId: string): Promise<void>;
  getStartPageToken(): Promise<string>;
  listChanges(pageToken: string): Promise<DriveChangePage>;
  download(fileId: string): Promise<Buffer>;
  createFile(file: NewFile): Promise<string>;
  updateFileContent(fileId: string, mimeType: string, content: Buffer): Promise<void>;
  // Files of ours in a folder that carry all the given appProperties.
  findOwnFiles(parentId: string, tags: Record<string, string>): Promise<string[]>;
  deleteFile(fileId: string): Promise<void>;
};

// status is the HTTP status, reason Google's short error code.
export class DriveApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly reason: string | null,
  ) {
    super(message);
    this.name = "DriveApiError";
  }
}

export function isDriveError(error: unknown, ...statuses: number[]): error is DriveApiError {
  return error instanceof DriveApiError && error.status !== null && statuses.includes(error.status);
}

export function folderUrl(folderId: string) {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

const FILE_FIELDS =
  "id,name,mimeType,size,trashed,parents,owners(emailAddress),lastModifyingUser(emailAddress),appProperties";
const ALL_DRIVES = { supportsAllDrives: true } as const;

type RawFile = {
  id?: string | null;
  name?: string | null;
  mimeType?: string | null;
  size?: string | null;
  trashed?: boolean | null;
  parents?: string[] | null;
  owners?: { emailAddress?: string | null }[] | null;
  lastModifyingUser?: { emailAddress?: string | null } | null;
  appProperties?: Record<string, string> | null;
};

function toFile(raw: RawFile): DriveFile {
  return {
    id: raw.id ?? "",
    name: raw.name ?? "",
    mimeType: raw.mimeType ?? "",
    size: raw.size == null ? null : Number(raw.size),
    trashed: raw.trashed ?? false,
    parents: raw.parents ?? [],
    ownerEmail: raw.owners?.[0]?.emailAddress ?? null,
    lastModifierEmail: raw.lastModifyingUser?.emailAddress ?? null,
    appProperties: raw.appProperties ?? {},
  };
}

function toDriveError(error: unknown) {
  if (error instanceof GoogleNotConnectedError || error instanceof DriveApiError) return error;
  const response = (error as { response?: { status?: number; data?: unknown } })?.response;
  const body = (response?.data as { error?: { message?: string; errors?: { reason?: string }[] } })
    ?.error;
  return new DriveApiError(
    body?.message ?? (error instanceof Error ? error.message : String(error)),
    response?.status ?? null,
    body?.errors?.[0]?.reason ?? null,
  );
}

async function call<T>(request: () => Promise<T>) {
  try {
    return await request();
  } catch (error) {
    throw toDriveError(error);
  }
}

function quote(value: string) {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export function createDrive(auth: Auth.OAuth2Client): DriveClient {
  const drive = google.drive({ version: "v3", auth });
  // The upload takes text or a stream, and text would damage the bytes.
  const media = (mimeType: string, content: Buffer) => ({
    mimeType,
    body: Readable.from([content]),
  });

  return {
    createFolder: (name, parentId) =>
      call(async () => {
        const { data } = await drive.files.create({
          ...ALL_DRIVES,
          fields: "id",
          requestBody: {
            name,
            mimeType: FOLDER_MIME_TYPE,
            parents: parentId ? [parentId] : undefined,
            appProperties: { screener: "folder" satisfies OwnFileKind },
            writersCanShare: false,
          },
        });
        if (!data.id) throw new Error(`Folder ${name} was not created.`);
        return data.id;
      }),

    getFile: (fileId) =>
      call(async () => {
        const { data } = await drive.files.get({ ...ALL_DRIVES, fileId, fields: FILE_FIELDS });
        return toFile(data);
      }),

    rename: (fileId, name) =>
      call(async () => {
        await drive.files.update({ ...ALL_DRIVES, fileId, requestBody: { name }, fields: "id" });
      }),

    listPermissions: (fileId) =>
      call(async () => {
        const permissions: DrivePermission[] = [];
        let pageToken: string | undefined;
        do {
          const { data } = await drive.permissions.list({
            ...ALL_DRIVES,
            fileId,
            pageSize: 100,
            pageToken,
            fields:
              "nextPageToken,permissions(id,type,role,emailAddress,domain,permissionDetails(inherited))",
          });
          for (const permission of data.permissions ?? []) {
            if (!permission.id) continue;
            const details = permission.permissionDetails ?? [];
            permissions.push({
              id: permission.id,
              type: permission.type ?? "",
              role: permission.role ?? "",
              emailAddress: permission.emailAddress ?? null,
              domain: permission.domain ?? null,
              inherited:
                details.length > 0 ? details.every((detail) => detail.inherited === true) : null,
            });
          }
          pageToken = data.nextPageToken ?? undefined;
        } while (pageToken);
        return permissions;
      }),

    shareWithUser: (fileId, email, message) =>
      call(async () => {
        const { data } = await drive.permissions.create({
          ...ALL_DRIVES,
          fileId,
          sendNotificationEmail: true,
          emailMessage: message,
          fields: "id",
          requestBody: { type: "user", role: "writer", emailAddress: email },
        });
        if (!data.id) throw new Error("The permission was not created.");
        return data.id;
      }),

    deletePermission: (fileId, permissionId) =>
      call(async () => {
        await drive.permissions.delete({ ...ALL_DRIVES, fileId, permissionId });
      }),

    getStartPageToken: () =>
      call(async () => {
        const { data } = await drive.changes.getStartPageToken({ ...ALL_DRIVES });
        if (!data.startPageToken) throw new Error("Drive gave no start page token.");
        return data.startPageToken;
      }),

    listChanges: (pageToken) =>
      call(async () => {
        const { data } = await drive.changes.list({
          ...ALL_DRIVES,
          includeItemsFromAllDrives: true,
          pageToken,
          pageSize: 100,
          fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FILE_FIELDS}))`,
        });
        return {
          changes: (data.changes ?? []).flatMap((change) =>
            change.fileId
              ? [
                  {
                    fileId: change.fileId,
                    removed: change.removed ?? false,
                    file: change.file ? toFile(change.file) : null,
                  },
                ]
              : [],
          ),
          nextPageToken: data.nextPageToken ?? null,
          newStartPageToken: data.newStartPageToken ?? null,
        };
      }),

    download: (fileId) =>
      call(async () => {
        const { data } = await drive.files.get(
          { ...ALL_DRIVES, fileId, alt: "media" },
          { responseType: "arraybuffer" },
        );
        return Buffer.from(data as unknown as ArrayBuffer);
      }),

    createFile: ({ name, parentId, mimeType, content, kind, tags }) =>
      call(async () => {
        const { data } = await drive.files.create({
          ...ALL_DRIVES,
          fields: "id",
          requestBody: { name, parents: [parentId], appProperties: { ...tags, screener: kind } },
          media: media(mimeType, content),
        });
        if (!data.id) throw new Error(`File ${name} was not created.`);
        return data.id;
      }),

    updateFileContent: (fileId, mimeType, content) =>
      call(async () => {
        await drive.files.update({
          ...ALL_DRIVES,
          fileId,
          fields: "id",
          media: media(mimeType, content),
        });
      }),

    findOwnFiles: (parentId, tags) =>
      call(async () => {
        const conditions = Object.entries(tags).map(
          ([key, value]) => `appProperties has { key=${quote(key)} and value=${quote(value)} }`,
        );
        const { data } = await drive.files.list({
          ...ALL_DRIVES,
          includeItemsFromAllDrives: true,
          q: [`${quote(parentId)} in parents`, "trashed = false", ...conditions].join(" and "),
          fields: "files(id)",
          pageSize: 10,
        });
        return (data.files ?? []).flatMap((file) => (file.id ? [file.id] : []));
      }),

    deleteFile: (fileId) =>
      call(async () => {
        await drive.files.delete({ ...ALL_DRIVES, fileId });
      }),
  };
}

let current: { auth: Auth.OAuth2Client; drive: DriveClient } | undefined;

// The system account's Drive. Throws GoogleNotConnectedError when there is none.
export async function getDrive() {
  const auth = await getSystemAuth();
  if (current?.auth !== auth) current = { auth, drive: createDrive(auth) };
  return current.drive;
}
