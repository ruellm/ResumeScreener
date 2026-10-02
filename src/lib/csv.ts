// The byte order mark, so Excel reads the file as UTF-8.
const BOM = String.fromCharCode(0xfeff);

// A spreadsheet treats a cell that starts with one of these as a formula.
const FORMULA_START = /^[=+\-@\t\r]/;

// Phone numbers may start with + or - and are left as they are.
const PHONE = /^\+?[0-9 ()\-]{7,20}$/;

function cell(value: string | number | null | undefined) {
  let text = value == null ? "" : String(value);
  if (FORMULA_START.test(text) && !PHONE.test(text)) text = `'${text}`;
  // RFC 4180: quote when the cell has a comma, a quote or a line break.
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: (string | number | null | undefined)[][]) {
  return BOM + rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
