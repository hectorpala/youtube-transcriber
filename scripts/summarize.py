#!/usr/bin/env python3
"""
Summarize a transcription using Claude CLI (Max subscription).
Usage: python3 summarize.py <md_file_path>

Reads the .md file (with YAML frontmatter + transcription text),
asks Claude to generate a structured summary, and rewrites the .md
with the summary inserted between frontmatter and the raw text.

Outputs JSON lines:
  {"type":"progress","message":"..."}
  {"type":"result","summary_chars":N,"file":"..."}
  {"type":"error","message":"..."}
"""

import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime

CLAUDE_SEARCH_PATHS = [
    os.path.expanduser("~/.npm-global/bin/claude"),
    "/opt/homebrew/bin/claude",
    "/usr/local/bin/claude",
]


def find_claude() -> str:
    found = shutil.which("claude")
    if found:
        return found
    for p in CLAUDE_SEARCH_PATHS:
        if os.path.isfile(p) and os.access(p, os.X_OK):
            return p
    return "claude"


def log(stage: str, msg: str) -> None:
    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    print(f"[{ts}] [summarize] [{stage}] {msg}", file=sys.stderr, flush=True)


SUMMARY_PROMPT = """Eres un analista experto en trading. Te voy a dar la transcripción de un video de YouTube de un canal de trading.

Genera un resumen estructurado en markdown con ESTAS secciones exactas:

## Resumen ejecutivo
(2-3 oraciones sobre el mensaje principal del video)

## Contexto de mercado
(qué está pasando en el mercado según el análisis del video)

## Tickers / Activos mencionados
(lista de símbolos: BTC, ETH, XRP, oro, etc., cada uno con una nota breve de lo que se dijo)

## Niveles de precio clave
(lista de precios específicos mencionados como soportes, resistencias, targets, stop loss)

## Estrategia / Setup identificado
(describe el setup operativo propuesto: dirección long/short, entrada, stop, target, apalancamiento, temporalidad)

## Indicadores usados
(RSI, MACD, ADX, medias móviles, etc. que se mencionan)

## Conclusión / Acción sugerida
(qué recomienda hacer el autor: comprar, vender, esperar, cerrar posiciones)

Responde SOLO con el markdown del resumen, sin preámbulos ni aclaraciones. Sé conciso. Si alguna sección no aplica, escribe "No mencionado"."""


def read_md(path: str):
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    # Split frontmatter from body
    if content.startswith("---\n"):
        end = content.find("\n---\n", 4)
        if end != -1:
            frontmatter = content[:end + 5]
            body = content[end + 5:].lstrip()
            return frontmatter, body
    return "", content


def has_summary(body: str) -> bool:
    return "## Resumen ejecutivo" in body[:500]


def summarize(md_path: str):
    t_script_start = time.perf_counter()
    log("start", f"file={md_path}")

    if not os.path.isfile(md_path):
        print(json.dumps({"type": "error", "message": f"File not found: {md_path}"}), flush=True)
        sys.exit(1)

    file_size = os.path.getsize(md_path)
    log("input", f"file_size_bytes={file_size}")

    print(json.dumps({"type": "progress", "message": "Reading transcription..."}), flush=True)

    t_read_start = time.perf_counter()
    frontmatter, body = read_md(md_path)
    t_read_end = time.perf_counter()
    log("read", f"done in {(t_read_end - t_read_start) * 1000:.1f}ms "
                f"frontmatter_chars={len(frontmatter)} body_chars={len(body)}")

    if has_summary(body):
        total_ms = (time.perf_counter() - t_script_start) * 1000
        log("skip", f"summary already exists — total {total_ms:.1f}ms")
        print(json.dumps({"type": "progress", "message": "Summary already exists, skipping."}), flush=True)
        print(json.dumps({
            "type": "result", "summary_chars": 0, "file": md_path, "skipped": True,
            "duration_ms": round(total_ms, 1),
            "claude_ms": 0,
            "input_chars": len(body),
            "file_size_bytes": file_size,
        }), flush=True)
        return

    # Limit transcription size to avoid huge prompts — use first 60k chars
    text = body.strip()
    original_chars = len(text)
    truncated = False
    if len(text) > 60000:
        text = text[:60000] + "\n\n[... transcripción truncada ...]"
        truncated = True
    log("prompt", f"input_chars={original_chars} sent_chars={len(text)} truncated={truncated}")

    print(json.dumps({"type": "progress", "message": f"Calling Claude ({len(text)} chars)..."}), flush=True)

    claude_bin = find_claude()
    full_prompt = f"{SUMMARY_PROMPT}\n\n---\nTRANSCRIPCIÓN:\n\n{text}"
    log("claude", f"bin={claude_bin} prompt_chars={len(full_prompt)} — invoking CLI...")
    t_claude_start = time.perf_counter()

    try:
        proc = subprocess.run(
            [claude_bin, "-p", "--disable-slash-commands", "--dangerously-skip-permissions", full_prompt],
            capture_output=True,
            text=True,
            timeout=180,
        )
    except FileNotFoundError:
        print(json.dumps({"type": "error", "message": "claude CLI not found. Install with: npm i -g @anthropic-ai/claude-code"}), flush=True)
        sys.exit(1)
    except subprocess.TimeoutExpired:
        log("claude", "TIMEOUT after 180s")
        print(json.dumps({"type": "error", "message": "Claude call timed out after 180s"}), flush=True)
        sys.exit(1)

    t_claude_end = time.perf_counter()
    claude_ms = (t_claude_end - t_claude_start) * 1000
    log("claude", f"done in {claude_ms:.1f}ms rc={proc.returncode} "
                  f"stdout_chars={len(proc.stdout)} stderr_chars={len(proc.stderr)}")

    if proc.returncode != 0:
        print(json.dumps({"type": "error", "message": f"claude returned {proc.returncode}: {proc.stderr[:300]}"}), flush=True)
        sys.exit(1)

    summary = proc.stdout.strip()
    if len(summary) < 100:
        print(json.dumps({"type": "error", "message": f"Summary too short ({len(summary)} chars), likely failed: {summary[:200]}"}), flush=True)
        sys.exit(1)

    # Rewrite the .md with summary inserted
    new_content = f"{frontmatter}\n{summary}\n\n---\n\n## Transcripción completa\n\n{body}"

    t_write_start = time.perf_counter()
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(new_content)
    t_write_end = time.perf_counter()
    log("write", f"done in {(t_write_end - t_write_start) * 1000:.1f}ms "
                 f"new_file_bytes={len(new_content.encode('utf-8'))} summary_chars={len(summary)}")

    total_ms = (time.perf_counter() - t_script_start) * 1000
    claude_pct = (claude_ms / total_ms * 100) if total_ms > 0 else 0
    log("done", f"total {total_ms:.1f}ms (claude {claude_ms:.1f}ms = {claude_pct:.1f}%)")

    print(json.dumps({"type": "progress", "message": "Summary saved."}), flush=True)
    print(json.dumps({
        "type": "result", "summary_chars": len(summary), "file": md_path, "skipped": False,
        "duration_ms": round(total_ms, 1),
        "claude_ms": round(claude_ms, 1),
        "input_chars": original_chars,
        "file_size_bytes": file_size,
    }), flush=True)


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"type": "error", "message": "Usage: summarize.py <md_file_path>"}), flush=True)
        sys.exit(1)
    summarize(sys.argv[1])
