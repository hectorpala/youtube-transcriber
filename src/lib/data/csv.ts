/**
 * Minimal, tolerant CSV parser.
 *
 * Design decisions:
 *  - No dependency on papaparse — the CSVs are simple (no quoted commas).
 *  - Handles rows with MORE columns than the header (schema drift) by mapping
 *    extra columns to auto-generated names: _extra_0, _extra_1 …
 *    Then the known extended column names are mapped back via EXTENDED_COLUMNS.
 *  - Handles rows with FEWER columns than the header (pads with "").
 *  - Trims whitespace from all values.
 *  - Skips completely empty lines.
 */

/** Known extended columns that may appear after the declared header. */
const TRADES_EXTENDED_COLUMNS = [
  "mode",
  "signal_price",
  "live_entry_price",
  "fill_entry_price",
  "entry_slippage_pct",
  "entry_slippage_usd",
  "funding_estimate",
] as const;

/** Maximum number of CSV rows to parse to prevent memory exhaustion. */
const MAX_CSV_ROWS = 100_000;

export function parseCsv(
  raw: string,
  extendedColumns?: readonly string[]
): Record<string, string>[] {
  const lines = raw.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];

  const headerLine = lines[0];
  const headers = headerLine.split(",").map((h) => h.trim());
  const headerCount = headers.length;

  const extended = extendedColumns ?? [];

  const rows: Record<string, string>[] = [];
  const rowLimit = Math.min(lines.length, MAX_CSV_ROWS + 1); // +1 for header

  for (let i = 1; i < rowLimit; i++) {
    const values = lines[i].split(",").map((v) => v.trim());
    const record: Record<string, string> = {};

    // Map known header columns
    for (let j = 0; j < headerCount; j++) {
      record[headers[j]] = values[j] ?? "";
    }

    // Map extra columns beyond the header
    if (values.length > headerCount) {
      for (let j = headerCount; j < values.length; j++) {
        const extIdx = j - headerCount;
        const colName = extIdx < extended.length ? extended[extIdx] : `_extra_${extIdx}`;
        record[colName] = values[j] ?? "";
      }
    }

    rows.push(record);
  }

  return rows;
}

/** Parse trades CSV specifically — aware of the extended columns. */
export function parseTradesCsv(raw: string): Record<string, string>[] {
  return parseCsv(raw, TRADES_EXTENDED_COLUMNS);
}

/** Parse execution CSV — straightforward, no known drift. */
export function parseExecutionCsv(raw: string): Record<string, string>[] {
  return parseCsv(raw);
}
