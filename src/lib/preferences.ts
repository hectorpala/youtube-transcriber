import { z } from "zod";

const STORAGE_KEY = "youtube-transcriber-preferences";

const preferencesSchema = z.object({
  theme: z.enum(["system", "dark", "light"]).default("system"),
});

export type Preferences = z.infer<typeof preferencesSchema>;

const DEFAULTS: Preferences = {
  theme: "system",
};

let listeners: Array<() => void> = [];
let cached: Preferences | null = null;

function notify() {
  cached = null;
  for (const listener of listeners) listener();
}

export function getPreferences(): Preferences {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return (cached = DEFAULTS);
    cached = preferencesSchema.parse(JSON.parse(raw));
    return cached;
  } catch {
    return (cached = DEFAULTS);
  }
}

function save(prefs: Preferences) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  notify();
}

export function setTheme(theme: Preferences["theme"]) {
  save({ ...getPreferences(), theme });
}

export function subscribe(listener: () => void) {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function getSnapshot(): Preferences {
  return getPreferences();
}
