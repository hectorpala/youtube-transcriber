#!/usr/bin/env python3
"""
Batch variant of update_brain.py — integrates N new video summaries into
CEREBRO.md with ONE Claude call instead of one per video.

Usage:
    python3 update_brain_batch.py <channel_dir> <summary_file_1> [<summary_file_2> ...]

- <channel_dir>: e.g. ~/Documents/trading-knowledge/TradingLatino
- <summary_file_N>: .md files already summarized (frontmatter + ## Resumen ejecutivo + transcription)

Emits JSON lines on stdout (progress + result) and timestamped logs on stderr.

JSON result schema:
    {"type":"result",
     "brain_file": "...",
     "action": "updated" | "created" | "skipped",
     "total_files": N,
     "processed_files": M,               # files actually sent to Claude (not pre-skipped)
     "skipped_files": N - M,
     "total_summary_chars": int,
     "cerebro_bytes_before": int,
     "cerebro_bytes_after": int,
     "delta_bytes": int,
     "claude_ms": float,
     "duration_ms": float}

Behavior:
- Reads CEREBRO.md once (or uses template if missing).
- Pre-filters summary files whose label already appears in CEREBRO.md.
- If all N are already present, short-circuits without calling Claude.
- Otherwise sends a single prompt containing CEREBRO + all new summaries, and
  writes the new CEREBRO.md atomically (tempfile + os.replace).

This script intentionally does NOT change the semantic dedupe rules used in
update_brain.py; it only batches the I/O and the Claude call.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
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
    print(f"[{ts}] [brain_batch] [{stage}] {msg}", file=sys.stderr, flush=True)


def emit(obj: dict) -> None:
    print(json.dumps(obj), flush=True)


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


BATCH_UPDATE_PROMPT = """Eres un analista que mantiene un documento de conocimiento consolidado ("cerebro") de un trader de YouTube. Te voy a dar el cerebro actual y UN BLOQUE de N nuevos resúmenes de video. Tu trabajo es integrar TODO el conocimiento nuevo en un solo paso.

OBJETIVO PRINCIPAL: El cerebro debe CRECER SOLO con información NUEVA. Repetir lo que ya está no aporta; refuerza la señal con un contador, no duplicando texto.

FILTRO DE VALOR (OBLIGATORIO):
- El cerebro NO es bitácora diaria ni "foto del mercado". Debe guardar conocimiento reusable para decidir mejor en el futuro.
- Antes de integrar cualquier idea, pregúntate: "¿esto ayuda a decidir mejor en el futuro, o solo describe lo que pasó hoy?".
- Si algo es principalmente snapshot táctico del día, NO lo agregues al cerebro salvo, como mucho, reforzar una idea ya existente mediante contador.
- LOW VALUE / ignorar:
  - precio puntual del día, rango puntual del día, target intradía sin doctrina reusable
  - lista de tickers sin enseñanza transferible
  - comentario macro pasajero sin regla operativa
  - opiniones tácticas que dependen del contexto exacto de esa sesión
- HIGH VALUE:
  - regla operativa reusable
  - setup repetible
  - gestión de riesgo
  - psicología / regla mental
  - uso de indicador con condición concreta reusable
  - patrón recurrente que cambie decisiones futuras
- Si un resumen es 80% snapshot y 20% señal reusable, integra SOLO esa señal reusable y descarta el resto.
- Distribución esperada: la mayoría de los cambios deben ser refuerzos/compresión de lo existente; muy pocas líneas realmente nuevas.

REGLAS ESTRICTAS DE DEDUPLICACIÓN (aplican al cerebro actual y TAMBIÉN entre los nuevos resúmenes entre sí):
1. **Antes de escribir cualquier cosa nueva**, revisa si YA está en el cerebro actual (aunque esté redactado diferente). Si el concepto ya existe, NO lo repitas con otras palabras.
2. Si un resumen MENCIONA algo que ya está registrado (mismo indicador, misma estrategia, misma regla):
   - NO agregues nueva línea ni nuevo bullet.
   - Busca la línea existente y agrega/incrementa al final: `(visto en N videos)` → `(visto en N+1 videos)`. Si no había contador, agrega `(visto en 2 videos)`.
3. Si el MISMO concepto aparece en varios de los nuevos resúmenes, cuenta TODAS las apariciones al incrementar el contador (ej: si ADX aparecía antes como `visto en 3 videos` y los nuevos resúmenes 1 y 3 también lo mencionan, el resultado debe ser `visto en 5 videos`).
4. Solo agrega un bullet/línea nueva si algún nuevo video introduce algo GENUINAMENTE NUEVO que no está en el cerebro ni en otro nuevo resumen del bloque.
   Además, esa línea nueva debe ser reusable. Si depende de un precio puntual, de un ticker del día o de un snapshot táctico, NO la agregues.
5. Si un nuevo video DETALLA o MATIZA algo ya conocido (ej: ya sabíamos "usa RSI", ahora aprendemos "usa RSI con configuración 14 y señal cruce de 30"), INTEGRA el detalle dentro de la entrada existente, no crees una nueva.
6. Si un concepto ya aparece en múltiples secciones (ej: una regla de riesgo que también está en psicología), consolídalo en la sección más apropiada y referencialo desde la otra con una línea corta.
7. Si hay contradicción con lo existente, déjalo anotado: `(en video X dijo Y, pero aquí dijo W)`.
8. En "Videos fuente procesados" SIEMPRE agrega al final UNA entrada por cada nuevo video procesado: `- YYYY-MM-DD: [título corto]`. Mantén el orden en el que te paso los nuevos resúmenes.
9. NO borres información útil previa.
10. Sé CONCISO: cada estrategia máximo 5 líneas, cada indicador máximo 2 líneas, cada regla máximo 1-2 líneas.
11. Si el cerebro tiene placeholders ("Ninguno registrado aún"), reemplázalos con el contenido nuevo.
12. Responde SOLO con el markdown completo del cerebro actualizado. Sin preámbulos, sin código, sin explicaciones. Primer carácter debe ser `#`.

EJEMPLO DE DEDUPLICACIÓN CORRECTA:
- Cerebro actual dice: `- **ADX**: valor <23 indica lateral`
- Nuevo video 1 dice: "ADX menor a 23 confirma mercado lateral"
- Nuevo video 2 dice: "Cuando el ADX está debajo de 23, no hay tendencia"
- ACCIÓN CORRECTA: cambiar a `- **ADX**: valor <23 indica lateral (visto en 3 videos)`
- ACCIÓN INCORRECTA: agregar bullets adicionales sobre ADX

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


def read_summary_from_md(md_path: str):
    """Extract the summary section + title/date from a transcription .md.
    Copied verbatim from update_brain.py to avoid coupling.
    """
    with open(md_path, "r", encoding="utf-8") as f:
        content = f.read()

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

    summary_text = content
    if "---\n" in content:
        parts = content.split("\n---\n", 2)
        if len(parts) >= 2:
            summary_text = parts[1]

    if "## Transcripción completa" in summary_text:
        summary_text = summary_text.split("## Transcripción completa")[0]

    return summary_text.strip(), f"{date}: {title}"


def _normalize(s: str) -> str:
    return (s
        .replace("\u2019", "'")
        .replace("\u2018", "'")
        .replace("\u201C", '"')
        .replace("\u201D", '"')
        .replace("\u2013", "-")
        .replace("\u2014", "-")
        .lower()
    )


def already_in_brain(current_brain: str, video_label: str) -> bool:
    normalized_brain = _normalize(current_brain)
    normalized_label = _normalize(video_label)
    date_prefix = video_label.split(":", 1)[0].strip()
    title_start = _normalize(video_label.split(":", 1)[1].strip()[:30]) if ":" in video_label else ""
    return (
        normalized_label in normalized_brain
        or (bool(date_prefix) and bool(title_start)
            and f"{date_prefix}:" in current_brain
            and title_start in normalized_brain)
    )


def atomic_write(path: str, content: str) -> None:
    """Write via tempfile + os.replace to avoid partially-written CEREBRO.md on crash."""
    dir_ = os.path.dirname(path) or "."
    fd, tmp = tempfile.mkstemp(prefix=".CEREBRO.", suffix=".tmp", dir=dir_)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
        os.replace(tmp, path)
    except Exception:
        if os.path.exists(tmp):
            try:
                os.remove(tmp)
            except OSError:
                pass
        raise


def update_brain_batch(channel_dir: str, summary_files: list[str]) -> None:
    t_script_start = time.perf_counter()
    log("start", f"channel_dir={channel_dir} files={len(summary_files)}")

    if not os.path.isdir(channel_dir):
        emit({"type": "error", "message": f"Channel dir not found: {channel_dir}"})
        sys.exit(1)
    if not summary_files:
        emit({"type": "error", "message": "No summary files provided"})
        sys.exit(1)
    for f in summary_files:
        if not os.path.isfile(f):
            emit({"type": "error", "message": f"Summary file not found: {f}"})
            sys.exit(1)

    brain_path = os.path.join(channel_dir, "CEREBRO.md")

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

    emit({"type": "progress", "message": f"Reading {len(summary_files)} summary file(s)..."})

    # Read summaries + filter out already-present ones
    t_sum_read_start = time.perf_counter()
    new_entries = []
    skipped = []
    for path in summary_files:
        try:
            summary_text, video_label = read_summary_from_md(path)
        except Exception as e:
            emit({"type": "error", "message": f"Failed reading {path}: {e}"})
            sys.exit(1)
        if len(summary_text) < 100:
            emit({"type": "error", "message": f"Summary too short or missing in {path}"})
            sys.exit(1)
        if already_in_brain(current_brain, video_label):
            skipped.append((path, video_label))
            continue
        new_entries.append((path, video_label, summary_text))
    t_sum_read_end = time.perf_counter()

    total_summary_chars = sum(len(s) for _, _, s in new_entries)
    log("summary_read",
        f"done in {(t_sum_read_end - t_sum_read_start) * 1000:.1f}ms "
        f"total={len(summary_files)} new={len(new_entries)} already_in_brain={len(skipped)} "
        f"total_summary_chars={total_summary_chars}")

    if not new_entries:
        total_ms = (time.perf_counter() - t_script_start) * 1000
        log("skip", f"all {len(summary_files)} videos already in brain — total {total_ms:.1f}ms")
        emit({"type": "progress", "message": "All videos already in brain, skipping."})
        emit({
            "type": "result",
            "brain_file": brain_path,
            "action": "skipped",
            "total_files": len(summary_files),
            "processed_files": 0,
            "skipped_files": len(skipped),
            "total_summary_chars": 0,
            "cerebro_bytes_before": brain_size_before,
            "cerebro_bytes_after": brain_size_before,
            "delta_bytes": 0,
            "claude_ms": 0,
            "duration_ms": round(total_ms, 1),
        })
        return

    # Build one prompt with all new summaries as a block
    blocks = []
    for i, (_, video_label, summary_text) in enumerate(new_entries, 1):
        blocks.append(f"### Nuevo resumen {i} (video: {video_label})\n\n{summary_text}")
    new_block = "\n\n".join(blocks)

    full_prompt = (
        f"{BATCH_UPDATE_PROMPT}\n\n"
        f"---\nCEREBRO ACTUAL:\n\n{current_brain}\n\n"
        f"---\nBLOQUE DE {len(new_entries)} NUEVOS RESÚMENES "
        f"(procésalos TODOS en una pasada, luego emite el cerebro final):\n\n{new_block}\n"
    )

    claude_bin = find_claude()
    # Scale timeout with payload: base 480s + 60s per extra file, cap 1800s.
    timeout_s = min(1800, 480 + max(0, len(new_entries) - 1) * 60)
    log("claude",
        f"bin={claude_bin} prompt_chars={len(full_prompt)} "
        f"(brain={len(current_brain)} + summaries={total_summary_chars}) "
        f"timeout_s={timeout_s} files={len(new_entries)} — invoking CLI...")

    emit({"type": "progress",
          "message": f"Calling Claude for batch of {len(new_entries)} video(s)..."})

    t_claude_start = time.perf_counter()
    try:
        proc = subprocess.run(
            [claude_bin, "-p",
             "--disable-slash-commands",
             "--dangerously-skip-permissions",
             full_prompt],
            capture_output=True,
            text=True,
            timeout=timeout_s,
        )
    except FileNotFoundError:
        emit({"type": "error", "message": "claude CLI not found"})
        sys.exit(1)
    except subprocess.TimeoutExpired:
        log("claude", f"TIMEOUT after {timeout_s}s")
        emit({"type": "error", "message": f"Claude call timed out after {timeout_s}s"})
        sys.exit(1)

    t_claude_end = time.perf_counter()
    claude_ms = (t_claude_end - t_claude_start) * 1000
    log("claude", f"done in {claude_ms:.1f}ms rc={proc.returncode} "
                  f"stdout_chars={len(proc.stdout)} stderr_chars={len(proc.stderr)}")

    if proc.returncode != 0:
        emit({"type": "error",
              "message": f"claude returned {proc.returncode}: {proc.stderr[:300]}"})
        sys.exit(1)

    new_brain = proc.stdout.strip()
    if not new_brain.startswith("#") or len(new_brain) < 200:
        emit({"type": "error",
              "message": f"Invalid brain output ({len(new_brain)} chars): {new_brain[:200]}"})
        sys.exit(1)

    # Safety guard: reject a shrinking output that loses a large fraction of existing bytes.
    # Batch integration can add or consolidate, but it should not delete the brain.
    if brain_size_before > 0 and len(new_brain.encode("utf-8")) < brain_size_before * 0.6:
        emit({"type": "error",
              "message": (f"Refusing to overwrite CEREBRO: new brain shrank from "
                          f"{brain_size_before} to {len(new_brain.encode('utf-8'))} bytes "
                          f"(>40% loss). Aborting to avoid data loss.")})
        sys.exit(1)

    t_write_start = time.perf_counter()
    atomic_write(brain_path, new_brain)
    t_write_end = time.perf_counter()

    new_brain_bytes = len(new_brain.encode("utf-8"))
    delta_bytes = new_brain_bytes - brain_size_before
    log("write", f"done in {(t_write_end - t_write_start) * 1000:.1f}ms "
                 f"cerebro_bytes_after={new_brain_bytes} delta_bytes={delta_bytes:+d}")

    total_ms = (time.perf_counter() - t_script_start) * 1000
    claude_pct = (claude_ms / total_ms * 100) if total_ms > 0 else 0
    log("done", f"total {total_ms:.1f}ms (claude {claude_ms:.1f}ms = {claude_pct:.1f}%) "
                f"action={action} processed={len(new_entries)} skipped={len(skipped)}")

    emit({"type": "progress", "message": f"Brain {action} with {len(new_entries)} new video(s)."})
    emit({
        "type": "result",
        "brain_file": brain_path,
        "action": action,
        "total_files": len(summary_files),
        "processed_files": len(new_entries),
        "skipped_files": len(skipped),
        "total_summary_chars": total_summary_chars,
        "cerebro_bytes_before": brain_size_before,
        "cerebro_bytes_after": new_brain_bytes,
        "delta_bytes": delta_bytes,
        "claude_ms": round(claude_ms, 1),
        "duration_ms": round(total_ms, 1),
    })


if __name__ == "__main__":
    if len(sys.argv) < 3:
        emit({"type": "error",
              "message": "Usage: update_brain_batch.py <channel_dir> <summary_file_1> [<summary_file_2> ...]"})
        sys.exit(1)
    update_brain_batch(sys.argv[1], sys.argv[2:])
