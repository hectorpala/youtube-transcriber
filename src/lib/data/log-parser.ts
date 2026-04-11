import type { LogLine } from "./schemas";

/**
 * Parse director_log.csv which is actually plain text, NOT CSV.
 * Format: [YYYY-MM-DD HH:MM:SS] message text here
 *
 * Classifies each line into a level based on content heuristics:
 *  - trade: contains "NUEVA", "TP hit", "SL hit", "TIMEOUT", "SL_PARCIAL"
 *  - regime: contains "RÉGIMEN", "CAMBIO"
 *  - warning: contains "rejected", "drift", "cooldown"
 *  - error: contains "ERROR", "Exception", "Traceback"
 *  - info: everything else
 */

const LOG_PATTERN = /^\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\]\s*(.*)$/;

const LEVEL_MATCHERS: Array<[LogLine["level"], RegExp]> = [
  ["error", /ERROR|Exception|Traceback/i],
  ["trade", /NUEVA|TP hit|SL hit|SL_PARCIAL|TIMEOUT|cerrada|close|P&L/i],
  ["regime", /RÉGIMEN|CAMBIO|régimen|regime/i],
  ["warning", /rejected|drift|cooldown|WARN/i],
];

function classifyLevel(message: string): LogLine["level"] {
  for (const [level, re] of LEVEL_MATCHERS) {
    if (re.test(message)) return level;
  }
  return "info";
}

export function parseLogLines(raw: string, lastN?: number): LogLine[] {
  const lines = raw.split("\n").filter((l) => l.trim() !== "");

  // Optionally take only the last N lines for performance
  const subset = lastN && lastN < lines.length
    ? lines.slice(-lastN)
    : lines;

  const result: LogLine[] = [];

  for (const line of subset) {
    const match = LOG_PATTERN.exec(line);
    if (match) {
      // Truncate message to schema max (1000 chars) to prevent oversized payloads
      const message = (match[2] ?? "").slice(0, 1000);
      result.push({
        timestamp: match[1],
        message,
        level: classifyLevel(message),
      });
    } else {
      // Lines without timestamp — continuation or malformed — attach to "info"
      result.push({
        timestamp: "",
        message: line.trim().slice(0, 1000),
        level: "info",
      });
    }
  }

  return result;
}
