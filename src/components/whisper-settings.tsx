"use client";

import { useEffect, useState } from "react";
import { getSetting, setSetting } from "@/lib/db";
import { WHISPER_MODEL_KEY, WHISPER_LANGUAGE_KEY } from "@/lib/batch-persistence";

const MODELS = [
  { value: "tiny", label: "tiny (rapidísimo)" },
  { value: "base", label: "base (rápido)" },
  { value: "small", label: "small (balance)" },
  { value: "medium", label: "medium (preciso)" },
  { value: "large", label: "large (máximo)" },
];

const LANGS = [
  { value: "auto", label: "Auto-detectar" },
  { value: "es", label: "Español" },
  { value: "en", label: "Inglés" },
];

const selectCls =
  "h-8 rounded-md border border-input bg-transparent px-2 text-xs " +
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

/**
 * Selector de modelo/idioma de Whisper. Persiste en la tabla settings; los
 * flujos de transcripción lo leen vía getWhisperOpts() al invocar el backend.
 * Solo afecta el fallback Whisper (los subtítulos de YouTube van primero).
 */
export function WhisperSettings() {
  const [model, setModel] = useState("small");
  const [language, setLanguage] = useState("auto");

  useEffect(() => {
    getSetting(WHISPER_MODEL_KEY).then((v) => v && setModel(v));
    getSetting(WHISPER_LANGUAGE_KEY).then((v) => v && setLanguage(v));
  }, []);

  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>Whisper:</span>
      <select
        className={selectCls}
        value={model}
        aria-label="Modelo de Whisper"
        onChange={(e) => {
          setModel(e.target.value);
          void setSetting(WHISPER_MODEL_KEY, e.target.value);
        }}
      >
        {MODELS.map((m) => (
          <option key={m.value} value={m.value}>{m.label}</option>
        ))}
      </select>
      <select
        className={selectCls}
        value={language}
        aria-label="Idioma de transcripción"
        onChange={(e) => {
          setLanguage(e.target.value);
          void setSetting(WHISPER_LANGUAGE_KEY, e.target.value);
        }}
      >
        {LANGS.map((l) => (
          <option key={l.value} value={l.value}>{l.label}</option>
        ))}
      </select>
    </div>
  );
}
