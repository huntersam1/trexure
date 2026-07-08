/**
 * Generic CSV serializer for the reporting layer (R1–R5). Pure and
 * dependency-free (no `server-only`) so it is trivially unit-testable and
 * reusable from any report builder. RFC-4180 style: fields containing a comma,
 * double-quote, or newline are wrapped in double-quotes with embedded quotes
 * doubled; rows are CRLF-terminated for maximum spreadsheet compatibility.
 */

export type CsvColumn<T> = {
  header: string;
  value: (row: T) => string | number | null | undefined;
};

function escapeCell(input: string | number | null | undefined): string {
  let s = input == null ? "" : String(input);
  // Formula-injection guard: a cell that leads with =, +, -, @, tab, or CR is
  // evaluated as a formula by Excel/Sheets (WEBSERVICE/HYPERLINK exfil, legacy
  // DDE exec). Reports carry user-controlled free-text (counterparty refs,
  // decrypted memos), so neutralize it with a leading apostrophe before the
  // RFC-4180 quoting below. Applies to every report (R1–R5) via the shared path.
  if (/^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Serialize a single row of already-stringable cells. */
export function csvRow(cells: (string | number | null | undefined)[]): string {
  return cells.map(escapeCell).join(",");
}

/** Serialize a header + typed rows into a CSV block (no trailing newline). */
export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const header = csvRow(columns.map((c) => c.header));
  if (rows.length === 0) return header;
  const body = rows.map((r) => csvRow(columns.map((c) => c.value(r)))).join("\r\n");
  return `${header}\r\n${body}`;
}

/**
 * Join multiple CSV blocks (e.g. a settled table, an exceptions table, a totals
 * table) into one downloadable file, separated by a blank line so spreadsheet
 * imports keep the sections visually distinct.
 */
export function joinCsvBlocks(blocks: string[]): string {
  return blocks.filter((b) => b.length > 0).join("\r\n\r\n");
}
