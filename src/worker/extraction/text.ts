export const EXTRACTED_TEXT_MAX_CHARS = 30000;

// Tab and newline are whitespace and are handled below. NUL in particular
// cannot be stored in a Postgres text column.
function isControl(code: number) {
  return (code < 32 && code !== 9 && code !== 10) || (code >= 127 && code <= 159);
}

// Same whitespace rules as AIntervue: collapse spaces and tabs, trim each
// line, keep paragraph breaks as one blank line.
export function cleanText(raw: string) {
  const text = raw.replace(/\r\n?/g, "\n");
  let kept = "";
  for (const char of text) {
    if (!isControl(char.codePointAt(0) ?? 0)) kept += char;
  }
  return kept
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
