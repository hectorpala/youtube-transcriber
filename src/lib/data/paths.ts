import path from "node:path";

// Bot data lives one directory up from the dashboard app
const BOT_ROOT =
  process.env.BOT_DATA_DIR ??
  path.resolve(process.cwd(), "..");

/**
 * Validate that a resolved path is within the expected BOT_ROOT directory.
 * Prevents path-traversal attacks (e.g. "../../etc/passwd").
 * Throws if the path escapes BOT_ROOT.
 */
export function validatePath(p: string): string {
  const resolved = path.resolve(p);
  const root = path.resolve(BOT_ROOT);
  if (!resolved.startsWith(root + path.sep)) {
    throw new Error(`Path traversal detected: path escapes bot data directory`);
  }
  return resolved;
}

function safePath(relative: string): string {
  const full = path.join(BOT_ROOT, relative);
  return validatePath(full);
}

export { BOT_ROOT };

export const DATA_PATHS = {
  directorState: safePath("director_state.json"),
  directorShadow: safePath("director_shadow.json"),
  directorTrades: safePath("director_trades.csv"),
  directorExecution: safePath("director_execution.csv"),
  directorLog: safePath("director_log.csv"),
  tovState: safePath("tov_state.json"),
  tovTrades: safePath("tov_trades.csv"),
  tovLog: safePath("tov_log.csv"),
} as const;
