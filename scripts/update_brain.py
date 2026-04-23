#!/usr/bin/env python3
"""
Update the CEREBRO.md file for a channel by integrating knowledge
from a new video summary, using Claude CLI (Max subscription).

Usage: python3 update_brain.py <channel_dir> <new_summary_file>

- <channel_dir>: e.g. ~/Documents/trading-knowledge/TradingLatino
- <new_summary_file>: path to the .md file just summarized

Outputs JSON lines:
  {"type":"progress","message":"..."}
  {"type":"result","brain_file":"...","action":"created"|"updated"}
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
    print(f"[{ts}] [brain] [{stage}] {msg}", file=sys.stderr, flush=True)


EMPTY_BRAIN_TEMPLATE = """# Cerebro del trader

## Perfil del trader
(A identificar con más videos)

## Indicadores que utiliza
(Ninguno registrado aún)

## Estrategias / Setups identificados
(Ninguna registrada aún)

## Reglas de gestión de riesgo
(Ninguna registrada aún)

## Psicología / Reglas mentales
(Ninguna registrada aún)

## Tickers / Activos que analiza frecuentemente
(Ninguno registrado aún)

## Patrones recurrentes observados
(Ninguno registrado aún)

## Videos fuente procesados
(Ninguno aún)
"""


UPDATE_PROMPT = """Eres un analista que mantiene un documento de conocimiento consolidado ("cerebro") de un trader de YouTube. Tu trabajo es integrar el conocimiento de UN NUEVO resumen de video dentro del cerebro existente.

OBJETIVO PRINCIPAL: El cerebro debe CRECER SOLO con información NUEVA. Repetir lo que ya está no aporta; refuerza la señal con un contador, no duplicando texto.

REGLAS ESTRICTAS DE DEDUPLICACIÓN:
1. **Antes de escribir cualquier cosa nueva**, revisa si YA está en el cerebro actual (aunque esté redactado diferente). Si el concepto ya existe, NO lo repitas con otras palabras.
2. Si el nuevo video MENCIONA algo que ya está registrado (mismo indicador, misma estrategia, misma regla):
   - NO agregues nueva línea ni nuevo bullet.
   - Busca la línea existente y agrega/incrementa al final: `(visto en N videos)` → `(visto en N+1 videos)`. Si no había contador, agrega `(visto en 2 videos)`.
3. Solo agrega un bullet/línea nueva si el video introduce algo GENUINAMENTE NUEVO que no está en el cerebro.
4. Si el nuevo video DETALLA o MATIZA algo ya conocido (ej: ya sabíamos "usa RSI", ahora aprendemos "usa RSI con configuración 14 y señal cruce de 30"), INTEGRA el detalle dentro de la entrada existente, no crees una nueva.
5. Si un concepto ya aparece en múltiples secciones (ej: una regla de riesgo que también está en psicología), consolídalo en la sección más apropiada y referencialo desde la otra con una línea corta.
6. Si hay contradicción con lo existente, déjalo anotado: `(en video X dijo Y, pero aquí dijo W)`.
7. En "Videos fuente procesados" SIEMPRE agrega la nueva entrada al final: `- YYYY-MM-DD: [título corto]`.
8. NO borres información útil previa.
9. Sé CONCISO: cada estrategia máximo 5 líneas, cada indicador máximo 2 líneas, cada regla máximo 1-2 líneas.
10. Si el cerebro tiene placeholders ("Ninguno registrado aún"), reemplázalos con el contenido nuevo.
11. Responde SOLO con el markdown completo del cerebro actualizado. Sin preámbulos, sin código, sin explicaciones. Primer carácter debe ser `#`.

EJEMPLO DE DEDUPLICACIÓN CORRECTA:
- Cerebro actual dice: `- **ADX**: valor <23 indica lateral`
- Nuevo video dice: "ADX menor a 23 confirma mercado lateral"
- ACCIÓN CORRECTA: cambiar a `- **ADX**: valor <23 indica lateral (visto en 2 videos)`
- ACCIÓN INCORRECTA: agregar otro bullet sobre ADX

Formato del cerebro (mantén estas secciones):
# Cerebro del trader
## Perfil del trader
## Indicadores que utiliza
## Estrategias / Setups identificados
## Reglas de gestión de riesgo
## Psicología / Reglas mentales
## Tickers / Activos que analiza frecuentemente
## Patrones recurrentes observados
## Videos fuente procesados
"""


def read_summary_from_md(md_path: str) -> tuple[str, str]:
    """Extract the summary section + title/date from a transcription .md with frontmatter + summary."""
    with open(md_path, "r", encoding="utf-8") as f:
        content = f.read()

    # Get title and date from frontmatter
    title = "Unknown"
    date = "unknown-date"
    if content.startswith("---\n"):
        end = content.find("\n---\n", 4)
        if end != -1:
            fm = content[:end]
            for line in fm.split("\n"):
                line = line.strip()
                if line.startswith("title:"):
                    title = line.split(":", 1)[1].strip().strip('"')
                elif line.startswith("date:"):
                    date = line.split(":", 1)[1].strip().strip('"')

    # Extract only the summary portion (between frontmatter end and "## Transcripción completa")
    summary_text = content
    if "---\n" in content:
        # Body is after second ---
        parts = content.split("\n---\n", 2)
        if len(parts) >= 2:
            summary_text = parts[1]

    # Cut off at the full transcription section
    if "## Transcripción completa" in summary_text:
        summary_text = summary_text.split("## Transcripción completa")[0]

    return summary_text.strip(), f"{date}: {title}"


def update_brain(channel_dir: str, summary_file: str):
    t_script_start = time.perf_counter()
    log("start", f"channel_dir={channel_dir} summary_file={summary_file}")

    if not os.path.isdir(channel_dir):
        print(json.dumps({"type": "error", "message": f"Channel dir not found: {channel_dir}"}), flush=True)
        sys.exit(1)
    if not os.path.isfile(summary_file):
        print(json.dumps({"type": "error", "message": f"Summary file not found: {summary_file}"}), flush=True)
        sys.exit(1)

    brain_path = os.path.join(channel_dir, "CEREBRO.md")
    summary_file_size = os.path.getsize(summary_file)
    log("input", f"summary_file_bytes={summary_file_size}")

    # Read existing brain (or use template)
    t_brain_read_start = time.perf_counter()
    if os.path.isfile(brain_path):
        brain_size_before = os.path.getsize(brain_path)
        with open(brain_path, "r", encoding="utf-8") as f:
            current_brain = f.read()
        action = "updated"
    else:
        brain_size_before = 0
        current_brain = EMPTY_BRAIN_TEMPLATE
        action = "created"
    t_brain_read_end = time.perf_counter()
    log("brain_read", f"done in {(t_brain_read_end - t_brain_read_start) * 1000:.1f}ms "
                     f"action={action} cerebro_bytes_before={brain_size_before} "
                     f"cerebro_chars={len(current_brain)}")

    print(json.dumps({"type": "progress", "message": "Reading new summary..."}), flush=True)

    t_sum_read_start = time.perf_counter()
    summary_text, video_label = read_summary_from_md(summary_file)
    t_sum_read_end = time.perf_counter()
    log("summary_read", f"done in {(t_sum_read_end - t_sum_read_start) * 1000:.1f}ms "
                       f"summary_chars={len(summary_text)} video_label={video_label!r}")

    if len(summary_text) < 100:
        print(json.dumps({"type": "error", "message": f"Summary too short or missing in {summary_file}"}), flush=True)
        sys.exit(1)

    # Check if this video is already in the brain — use normalized comparison
    # (Claude may rewrite apostrophes, quotes, etc.)
    def _normalize(s: str) -> str:
        return (s
            .replace("\u2019", "'")  # right single quote
            .replace("\u2018", "'")  # left single quote
            .replace("\u201C", '"')  # left double quote
            .replace("\u201D", '"')  # right double quote
            .replace("\u2013", "-")  # en dash
            .replace("\u2014", "-")  # em dash
            .lower()
        )

    normalized_brain = _normalize(current_brain)
    normalized_label = _normalize(video_label)
    # Also try matching just on date + first 30 chars of title
    date_prefix = video_label.split(":", 1)[0].strip()
    title_start = _normalize(video_label.split(":", 1)[1].strip()[:30]) if ":" in video_label else ""

    already = (
        normalized_label in normalized_brain
        or (date_prefix and title_start and f"{date_prefix}:" in current_brain and title_start in normalized_brain)
    )
    if already:
        total_ms = (time.perf_counter() - t_script_start) * 1000
        log("skip", f"video already in brain — total {total_ms:.1f}ms")
        print(json.dumps({"type": "progress", "message": "Video already in brain, skipping."}), flush=True)
        print(json.dumps({
            "type": "result", "brain_file": brain_path, "action": "skipped",
            "duration_ms": round(total_ms, 1),
            "claude_ms": 0,
            "cerebro_bytes_before": brain_size_before,
            "summary_chars": len(summary_text),
        }), flush=True)
        return

    print(json.dumps({"type": "progress", "message": "Calling Claude to integrate knowledge..."}), flush=True)

    claude_bin = find_claude()
    full_prompt = f"""{UPDATE_PROMPT}

---
CEREBRO ACTUAL:

{current_brain}

---
NUEVO RESUMEN (video: {video_label}):

{summary_text}
"""
    log("claude", f"bin={claude_bin} prompt_chars={len(full_prompt)} "
                  f"(brain={len(current_brain)} + summary={len(summary_text)}) — invoking CLI...")
    t_claude_start = time.perf_counter()

    try:
        proc = subprocess.run(
            [claude_bin, "-p", "--disable-slash-commands", "--dangerously-skip-permissions", full_prompt],
            capture_output=True,
            text=True,
            timeout=480,
        )
    except FileNotFoundError:
        print(json.dumps({"type": "error", "message": "claude CLI not found"}), flush=True)
        sys.exit(1)
    except subprocess.TimeoutExpired:
        log("claude", "TIMEOUT after 480s")
        print(json.dumps({"type": "error", "message": "Claude call timed out after 480s"}), flush=True)
        sys.exit(1)

    t_claude_end = time.perf_counter()
    claude_ms = (t_claude_end - t_claude_start) * 1000
    log("claude", f"done in {claude_ms:.1f}ms rc={proc.returncode} "
                  f"stdout_chars={len(proc.stdout)} stderr_chars={len(proc.stderr)}")

    if proc.returncode != 0:
        print(json.dumps({"type": "error", "message": f"claude returned {proc.returncode}: {proc.stderr[:300]}"}), flush=True)
        sys.exit(1)

    new_brain = proc.stdout.strip()
    if not new_brain.startswith("#") or len(new_brain) < 200:
        print(json.dumps({"type": "error", "message": f"Invalid brain output ({len(new_brain)} chars): {new_brain[:200]}"}), flush=True)
        sys.exit(1)

    t_write_start = time.perf_counter()
    with open(brain_path, "w", encoding="utf-8") as f:
        f.write(new_brain)
    t_write_end = time.perf_counter()
    new_brain_bytes = len(new_brain.encode("utf-8"))
    delta_bytes = new_brain_bytes - brain_size_before
    log("write", f"done in {(t_write_end - t_write_start) * 1000:.1f}ms "
                 f"cerebro_bytes_after={new_brain_bytes} delta_bytes={delta_bytes:+d}")

    total_ms = (time.perf_counter() - t_script_start) * 1000
    claude_pct = (claude_ms / total_ms * 100) if total_ms > 0 else 0
    log("done", f"total {total_ms:.1f}ms (claude {claude_ms:.1f}ms = {claude_pct:.1f}%) action={action}")

    print(json.dumps({"type": "progress", "message": f"Brain {action}."}), flush=True)
    print(json.dumps({
        "type": "result", "brain_file": brain_path, "action": action,
        "duration_ms": round(total_ms, 1),
        "claude_ms": round(claude_ms, 1),
        "cerebro_bytes_before": brain_size_before,
        "cerebro_bytes_after": new_brain_bytes,
        "delta_bytes": delta_bytes,
        "summary_chars": len(summary_text),
    }), flush=True)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"type": "error", "message": "Usage: update_brain.py <channel_dir> <summary_file>"}), flush=True)
        sys.exit(1)
    update_brain(sys.argv[1], sys.argv[2])
