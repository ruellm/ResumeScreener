export const IMPORT_MESSAGES = {
  unreachable: "Couldn't reach that page.",
  blocked: "That page needs a login or blocks automated access.",
  notAllowed: "That address isn't allowed.",
  tooLarge: "That page is too large.",
  notHtml: "That link isn't a web page.",
  // Replaced by a message that names the site.
  siteBlocked: "That site doesn't allow automatic import. Paste the job description instead.",
  unreadable:
    "Couldn't read that posting into the form. Paste the job description instead, or fill in the form manually.",
  overLimit:
    "You have reached today's import limit. Try again tomorrow or fill in the form manually.",
} as const;

export type ImportFailure = keyof typeof IMPORT_MESSAGES;

// A failure whose message is safe and short enough to show to the user.
export class ImportError extends Error {
  constructor(
    readonly code: ImportFailure,
    options?: ErrorOptions & { message?: string },
  ) {
    super(options?.message ?? IMPORT_MESSAGES[code], options);
    this.name = "ImportError";
  }
}
