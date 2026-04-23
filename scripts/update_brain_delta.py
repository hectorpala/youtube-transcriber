#!/usr/bin/env python3
"""
Delta-mode update of CEREBRO.md. Instead of asking Claude to re-emit the full
markdown, we ask for a structured JSON patch describing per-section changes,
then a deterministic Python applier mutates CEREBRO.md locally.

Usage:
    python3 update_brain_delta.py <channel_dir> <summary_file_1> [...]

Safety posture:
- Refuses to touch CEREBRO.md if required sections are missing.
- Refuses to write a shrunk output (>20% loss → abort).
- Rejects invalid JSON / schema mismatches.
- If zero ops resolved their target_keys (Claude hallucinated), refuses to write.
- Write is atomic (tempfile + os.replace).
- On any of the above errors, exits non-zero without mutating CEREBRO.md.
- The caller can retry with update_brain_batch.py as plan B.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import unicodedata
from datetime import datetime
from typing import Any

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
    print(f"[{ts}] [brain_delta] [{stage}] {msg}", file=sys.stderr, flush=True)


def emit(obj: dict) -> None:
    print(json.dumps(obj, ensure_ascii=False), flush=True)


# Canonical section order — must match update_brain*.py + EMPTY_BRAIN_TEMPLATE.
SECTIONS_ORDER = [
    "Perfil del trader",
    "Indicadores que utiliza",
    "Estrategias / Setups identificados",
    "Reglas de gestión de riesgo",
    "Psicología / Reglas mentales",
    "Tickers / Activos que analiza frecuentemente",
    "Patrones recurrentes observados",
    "Videos fuente procesados",
]

JSON_KEY_TO_SECTION = {
    "profile_updates": "Perfil del trader",
    "indicator_updates": "Indicadores que utiliza",
    "setup_updates": "Estrategias / Setups identificados",
    "risk_updates": "Reglas de gestión de riesgo",
    "psychology_updates": "Psicología / Reglas mentales",
    "ticker_updates": "Tickers / Activos que analiza frecuentemente",
    "pattern_updates": "Patrones recurrentes observados",
}

VALID_ACTIONS = {"add", "merge", "increment_evidence", "note_contradiction"}

PLACEHOLDER_PATTERNS = [
    r"^\(Ninguno registrado aún\)$",
    r"^\(Ninguna registrada aún\)$",
    r"^\(Ninguno aún\)$",
    r"^\(A identificar con más videos\)$",
]

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


DELTA_PROMPT = """Eres un analista que mantiene un documento de conocimiento consolidado ("cerebro") de un trader de YouTube. Te voy a dar:
1. El cerebro actual (markdown, SOLO para referencia — NO lo reescribas).
2. Un bloque con N resúmenes de videos NUEVOS.

Tu ÚNICA tarea es devolver UN OBJETO JSON que describa los cambios al cerebro. NO devuelvas el cerebro. NO devuelvas prosa. NO uses ```fences```. Responde SOLO con JSON válido, sin nada antes ni después.

ESQUEMA EXACTO DEL JSON (todas las claves son requeridas; usa [] si no hay cambios):
{
  "profile_updates":         [<OpItem>, ...],
  "indicator_updates":       [<OpItem>, ...],
  "setup_updates":           [<OpItem>, ...],
  "risk_updates":            [<OpItem>, ...],
  "psychology_updates":      [<OpItem>, ...],
  "ticker_updates":          [<OpItem>, ...],
  "pattern_updates":         [<OpItem>, ...],
  "video_sources_to_append": ["YYYY-MM-DD: título corto", ...]
}

Formato de OpItem:
  { "action": "add",                 "content": "- bullet completo" }
  { "action": "merge",               "target_key": "palabra clave existente", "content": "detalle extra" }
  { "action": "increment_evidence",  "target_key": "palabra clave existente", "evidence_count_delta": N }
  { "action": "note_contradiction",  "target_key": "palabra clave existente", "content": "en video X dijo Y, pero aquí dijo W" }

FILTRO DE VALOR (OBLIGATORIO, antes de decidir cualquier op):
- El cerebro NO es una bitácora diaria ni una "foto del mercado". Es un manual de decisión.
- Pregunta central para cada idea del resumen: "¿esto ayuda a decidir mejor en el futuro, o solo describe lo que pasó hoy?".
- Si una idea es principalmente snapshot táctico del día, NO debe generar op. Ignórala aunque el video la enfatice.
- Ejemplos de LOW VALUE / ignorar:
  - precio puntual del día, rango puntual del día, target intradía sin doctrina reusable
  - lista de tickers sin enseñanza transferible
  - comentario macro pasajero sin regla operativa
  - opinión táctica que depende del contexto exacto de esa sesión
- Ejemplos de HIGH VALUE:
  - regla operativa reusable
  - setup repetible
  - gestión de riesgo
  - psicología / regla mental
  - uso de indicador con condición concreta reusable
  - patrón recurrente que cambie decisiones futuras
- Si un resumen es 80% snapshot y 20% señal reusable, emite SOLO la señal reusable y descarta el resto.
- Distribución esperada de ops: la mayoría deben ser "increment_evidence"; algunas "merge"; muy pocas "add".

REGLAS ESTRICTAS:
1. Si un concepto YA aparece en el cerebro (aunque con otras palabras), NO uses "add". Elige entre:
   - "increment_evidence" (mismo concepto, sin detalle nuevo) — delta = cuántos de los nuevos resúmenes lo confirman.
   - "merge" (el nuevo resumen DETALLA / MATIZA lo existente) — content breve (<= 15 palabras).
   - "note_contradiction" (el nuevo resumen contradice lo existente).
2. Dedupe también entre los nuevos resúmenes entre sí: si 3 resúmenes mencionan el mismo concepto y el cerebro ya lo tenía con "(visto en 2 videos)", emite UN SOLO item con "increment_evidence" y evidence_count_delta=3.

3. "add" SOLO si es GENUINAMENTE nuevo (no está en el cerebro ni referenciable). content debe ser un bullet markdown completo (empezando con "- ") y conciso (<= 2 líneas).
   Además, ese "add" debe ser reusable. Si depende de un precio puntual, de un ticker del día o de un snapshot táctico, NO hagas add.
   Si dudas entre "increment_evidence" y "merge", elige "increment_evidence".
   Si dudas entre "merge" y "add", elige "merge".
   Si dudas entre "add" e ignorar, ignora.

4. **REGLA CRÍTICA DE target_key — LEER CON ATENCIÓN.**

   **4.0 REGLA DE COPIA VERBATIM — LÉELA ANTES QUE EL RESTO DE LA SECCIÓN.**

   target_key debe ser una subcadena **VERBATIM** del bullet destino, palabra por palabra, carácter por carácter (salvo markdown decorativo que el aplicador normaliza). Si tu target_key "suena limpio y bien redactado" pero NO es un copy-paste literal de 4-15 palabras consecutivas TAL COMO APARECEN ESCRITAS en el CEREBRO ACTUAL, estás parafraseando aunque no lo sientas así. Eso es un ERROR y el aplicador lo rechaza con target_missing.

   **Prohibido explícitamente (aunque el significado sea idéntico)**:
     - Resumir el bullet en tus palabras.
     - Cambiar "y" por "," o viceversa; cambiar ":" por "," o por espacio.
     - Quitar o añadir conectores ("de", "en", "con", "como", "tan", "todavía").
     - Cambiar un verbo por su sinónimo (ej: "descargar" → "vender", "usar" → "aplicar").
     - Completar una frase que está truncada en el bullet.
     - "Limpiar" tipografía cruda (paréntesis, guiones, barras) del bullet.
     - Armar una frase "doctrinal bonita" que condense el sentido del bullet pero no sea copia textual.
     - Amalgamar dos partes no contiguas del mismo bullet con puntuación inventada.

   **Si te suena a regla nítida y pulida, sospecha.** Los bullets del CEREBRO son prosa cruda escrita por resúmenes automáticos; casi nunca están redactados en forma de máxima perfecta. Una frase demasiado limpia, canónica o "sentenciosa" es casi siempre una paráfrasis inventada por ti, no una cita real.

   **CONTRAEJEMPLOS REALES de paráfrasis que FALLARON en validación reciente — NO HAGAS ESTO.**
   Los siguientes target_keys parecían correctos semánticamente pero fallaron con target_missing porque NO eran copy-paste literal del bullet real:

     ❌ `"Saber tomar ganancias es tan importante como saber entrar"`
        Sonaba doctrinal; no coincidió con el bullet real que puede tener conectores u orden distintos. Regla: copia literal del CEREBRO, no armes máximas canónicas.

     ❌ `"Protección post-compra / stop a break-even positivo"`
        Si esta frase existe textual en CEREBRO, cópiala íntegra e incluye también parte del cuerpo para distintivo (ej: "Protección post-compra / stop a break-even positivo: mover activo"). Un cabezal solo no distingue si hay bullets similares.

     ❌ `"Dejar correr ganadores: no cerrar al primer"`
        Frase cortada a media oración. Claude asumió que así era el bullet. El bullet real puede decir "no cerrar al primer +%" o "no cerrar al primer verde"; copia exacto, no supongas dónde corta.

     ❌ `"No usar take profits fijos en cripto: dejar correr"`
        Amalgama de dos partes del bullet con puntuación inventada. Elige UNA subfrase verbatim de ≥4 palabras consecutivas; no combines trozos distantes.

     ❌ `"Antes de entrar, preguntarse qué pasa si salta el stop loss"`
        Sonaba correcto pero el bullet real puede tener comillas, negritas, o un "y aceptar el riesgo" en medio que tu paráfrasis omitió o reordenó. El aplicador normaliza markdown (asteriscos, comillas) pero NO adivina palabras que falten.

   **Regla práctica de autoverificación antes de emitir merge/increment_evidence**:
     1. Localiza el bullet destino en el CEREBRO ACTUAL.
     2. Lee el bullet palabra por palabra.
     3. Selecciona mentalmente entre 4 y 15 palabras **consecutivas** del cuerpo del bullet (no del cabezal solo si el cabezal es demasiado genérico).
     4. Copia ese tramo **exacto** al campo target_key — sin reordenar, sin condensar, sin sinónimos.
     5. Si no puedes hacer el paso 3 con certeza absoluta, tu salida es `add` con bullet nuevo o **omitir** la op. NO inventes una frase "parecida".

   ---

   **4.0.1 SECCIÓN OBLIGATORIA — USA LA SECCIÓN DEL BULLET REAL, NO LA QUE "ENCAJE" SEMÁNTICAMENTE.**

   El aplicador busca el target_key **SOLO dentro de la sección que tú declaras** (p.ej. "indicator_updates" busca en "Indicadores que utiliza"; "psychology_updates" en "Psicología / Reglas mentales"; etc.). Si el bullet existe pero en otra sección, el aplicador reporta target_missing y tu op se pierde. Esto es `section_misroute` y es distinto de paráfrasis: la frase sí es literal, pero tú la ubicaste mal.

   **Regla absoluta**: la sección correcta es la sección DONDE APARECE EL BULLET EN EL CEREBRO ACTUAL. No es la que a ti te parezca la más apropiada, la más ordenada, ni la más semánticamente lógica. Es la sección **física** del documento tal como está escrito ahora mismo.

   **Antes de emitir merge/increment_evidence/note_contradiction**:
     1. Localiza el bullet literal en el CEREBRO ACTUAL.
     2. Busca hacia arriba hasta encontrar el último encabezado `## <Sección>` que precede al bullet.
     3. Esa sección — y NINGUNA OTRA — es donde debe ir la op (indicator_updates → "Indicadores que utiliza", etc. según el mapping de claves del JSON).
     4. Si no puedes ubicar con certeza la sección real del bullet, usa `add` en la sección que SÍ corresponde al nuevo bullet o **omite**.

   **Casos típicos donde Claude se equivoca (NO HAGAS ESTO)**:

     ❌ Un bullet sobre "distribución 30% riesgo / 60% psicología / 10% estrategia" puede SONAR a psicología, pero en el CEREBRO vive en `## Reglas de gestión de riesgo`. Emitirlo como `psychology_updates` falla target_missing aunque el target_key sea literal correcto.

     ❌ Un bullet sobre "stop loss al lado opuesto del patrón de confirmación" puede SONAR a gestión de riesgo, pero en el CEREBRO vive en `## Estrategias / Setups identificados` (porque describe un setup operativo, no una regla de sizing). Emitirlo como `risk_updates` falla target_missing.

   **Regla de desempate**: cuando dudes entre dos secciones para un bullet que existe, la única forma de acertar es LEER el CEREBRO ACTUAL y ver bajo qué `##` está el bullet. Si no tienes certeza, `add` u omitir, no adivines.

   ---

   **4.0.2 BULLETS DE TICKERS — NO AMALGAMES TICKER+CUERPO.**

   Los bullets de tickers/activos típicamente tienen la forma:
     `- **TICKER**: descripción técnica con múltiples detalles y cláusulas...`
   (ej: `- **ZRX**: sin entrada clara, esperar zona soporte; en marzo 2019 suelo redondeado + divergencia 4H...`).

   **Problema observado**: Claude construye target_keys del estilo `"ZRX: sin entrada clara, esperar zona soporte"` o `"IOTA: aún tiene fuerza alcista"` — un ticker como prefijo + una frase del cuerpo, separados por `:`. Esa amalgama NO es una subcadena literal del bullet real. El bullet real usa formato markdown (`**ZRX**:` con negrita o espacios distintos, o la descripción no empieza donde tú crees). Aunque el aplicador normalice markdown, la amalgama que tú armas no es una subcadena consecutiva del texto real.

   **Regla para tickers**:
     - target_key debe ser una subcadena consecutiva LITERAL del bullet completo tal como está escrito.
     - Si el ticker aparece al inicio como cabezal (`**TICKER**:`), **no lo antepongas tú mismo al target_key** a menos que copies también el formato exacto tal como aparece en el CEREBRO.
     - Lo más seguro: copia ÚNICAMENTE del cuerpo del bullet (lo que va después de `:`), eligiendo una subfrase distintiva de ≥4 palabras consecutivas.
     - Si el cuerpo del bullet no tiene una subfrase distintiva de 4+ palabras usable, `add` con un bullet nuevo específico u **omite**. No reconstruyas el bullet en formato "más canónico".

   **Contraejemplos (NO HAGAS ESTO)**:

     ❌ target_key: `"ZRX: sin entrada clara, esperar zona soporte"`
        Problema: combinaste ticker + frase del cuerpo con `:` inventado. El bullet real no tiene ese string como subcadena consecutiva.
        Corrección: cita sólo del cuerpo, p.ej. `"sin entrada clara, esperar zona soporte"` (si eso es subcadena literal del bullet) o incluye contexto del cuerpo `"suelo redondeado + divergencia alcista 4H"`.

     ❌ target_key: `"IOTA: aún tiene fuerza alcista"`
        Problema: mismo patrón. El bullet IOTA puede decir literalmente "aún tiene fuerza alcista, no entrar short todavía" — entonces tu target_key debe ser una subcadena de esa frase literal, SIN el prefix `IOTA:` a menos que esté escrito exactamente así.

   **Regla práctica**: si el bullet del ticker tiene formato `- **TICKER**: <cuerpo>`, tu target_key ideal es una subfrase distintiva de 4-15 palabras consecutivas TOMADA DEL CUERPO. Si necesitas distintivo porque el cuerpo es genérico, toma más palabras del cuerpo (no agregues el ticker como prefijo inventado).

   ---

   **CHECKLIST DE AUTO-VERIFICACIÓN (léela mentalmente antes de emitir CADA merge/increment/note_contradiction)**:
     □ ¿Localicé el bullet exacto en el CEREBRO ACTUAL?
     □ ¿Copié una subfrase literal de 4-15 palabras consecutivas del bullet?
     □ ¿La clave/sección que estoy usando corresponde a la sección REAL del bullet (la que está físicamente arriba del bullet en el CEREBRO, no la que me parece más lógica)?
     □ ¿NO le antepuse ticker ni inventé puntuación/prefijos que no están en el bullet literal?
     □ ¿NO estoy reconstruyendo el bullet en una forma "más limpia"?
   Si alguna respuesta es **"no" o "con dudas"**, la salida correcta es `add` con bullet nuevo **o** omitir la op. Mejor perder un increment que emitir target_missing.

   ---

   **CRÍTICO — los ejemplos en ESTE prompt son MOLDES ILUSTRATIVOS, NO textos reales del CEREBRO.**
   Nunca copies un ejemplo de este prompt como target_key (salvo que el bullet real del CEREBRO ACTUAL contenga exactamente esa frase — cosa improbable). Si lo haces y el bullet usa otras palabras, el aplicador va a reportar target_missing y tu op se pierde. Tu target_key SOLO puede salir del CEREBRO ACTUAL.

   Forma que debe tener un target_key BUENO (moldes con placeholders — no copies los placeholders, reemplázalos con 4-15 palabras literales del bullet real):
     - "<subfrase-distintiva-del-bullet-existente>"
     - "<fragmento-casi-unico-del-bullet-destino>"
     - "<indicador + parámetro o umbral exacto tal como figura en el bullet>"
     - "<setup + timeframe + condición literal tal como figura en el bullet>"
     - "<ticker + 4+ palabras de contexto literal del propio bullet>"
     - "<regla de riesgo con número y unidad exacta tal como figura en el bullet>"
     - "<patrón + zona temporal o precio que ya aparezca en el bullet>"
   Si no puedes extraer 4+ palabras consecutivas del bullet real para armar un target_key distintivo, tienes dos salidas seguras: (a) "add" con un bullet nuevo bien específico, (b) omitir la op. **Prohibido** inventar una frase "parecida", parafrasear libremente, o reusar un ejemplo de este prompt.

   target_keys MALOS (PROHIBIDOS, salvo que tengas CERTEZA de que el cerebro tiene solo UN bullet que contenga esa palabra):
     - Tickers sueltos: "BTC", "ETH", "XRP", "ADA", "LTC", "BNB", "SOL", "DOT", "Oro", "Plata", "Nasdaq", "SP500" — aparecen en muchos bullets
     - Indicadores sueltos: "RSI", "MACD", "ADX", "EMA", "MM", "VPVR", "OBV" — aparecen en múltiples líneas
     - Términos comunes: "Volumen", "Divergencia", "lateral", "short", "long", "manipulación", "tendencia", "breakout", "rebote"
     - Cualquier palabra de una sola palabra con <= 4 caracteres (ej: "gap", "stop", "risk")

   **IMPORTANTE — markdown decorativo y comillas NO vuelven distintivo un target_key.**
   El aplicador normaliza el texto: quita asteriscos, comillas curvas y rectas, backticks, y no distingue mayúsculas/minúsculas ni acentos. Por lo tanto todas estas variantes son EQUIVALENTES a un ticker suelto y siguen siendo AMBIGUAS:
     - "**ETH**", "__ETH__", "`ETH`", "*ETH*"  →  normaliza a "eth" → ambiguo
     - '"XRP"', "'XRP'", "«XRP»", "[XRP]"      →  normaliza a "xrp" → ambiguo
     - "**BNB**", "`BTC`"                       →  mismo caso
   Para referenciar un bullet de ticker, usa SIEMPRE contexto distintivo tomado del propio bullet (4+ palabras COPIADAS del contenido literal que aparece en el CEREBRO ACTUAL).
     Moldes aceptables para tickers (placeholders — NO los copies, reemplaza con texto literal del bullet real):
       - "<TICKER> <4+ palabras del contexto literal del bullet>"
       - "<TICKER> <precio o nivel exacto tal como figura en el bullet>"
       - "<TICKER> <setup + timeframe + condición literal del bullet>"
     Malos (aunque lleven adornos):
       - "ETH", "**ETH**", '"ETH"', "`ETH`"
       - "XRP", "*XRP*", "**XRP**"
       - "BTC", "**BTC**"
       - "BNB", "**BNB**"
   Si el bullet de ticker no tiene subfrase distintiva suficiente (4+ palabras propias que puedas CITAR literalmente), usa "add" con contenido específico o simplemente OMITE esa op. NUNCA uses ticker-only aunque lo decores. NUNCA inventes 4 palabras "parecidas" al bullet.

   **REGLA POSITIVA OBLIGATORIA para indicadores y términos genéricos** (MACD, RSI, ADX, EMA, MM, OBV, VPVR, Stochastic, Ichimoku, Divergencia, Volumen, Tendencia, Lateral, Short, Long, Breakout, Rebote, Manipulación — cualquier término del vocabulario técnico base).
   En CEREBROs reales estos términos aparecen en VARIOS bullets simultáneamente (ej: hay 3 bullets distintos que mencionan MACD, cada uno con un matiz diferente; hay 3 bullets de Divergencia en timeframes distintos). Emitir el término pelón hace que el aplicador marque AMBIGUOUS y la op se pierda.

   Si el concepto central del bullet que quieres referenciar es un indicador o término genérico, tu target_key DEBE incluir OBLIGATORIAMENTE al menos uno de estos anclajes, copiados literales del bullet:
     • parámetro numérico concreto presente en el bullet (ej: "14", "55", "9/21/55", "<23", ">70")
     • timeframe explícito presente en el bullet (ej: "4H", "1H", "diario", "semanal", "mensual")
     • umbral, señal o condición específica del bullet (ej: "cruce de 30", "valor <23 indica lateral", "histograma verde-rojo", "doble techo")
     • nombre compuesto completo tal como figura en el bullet (ej: "Squeeze Momentum", "Awesome Oscillator", "Perfil de Volumen de Rango Fijo", "Campana de Gauss")
     • o 4+ palabras consecutivas literales del bullet que rodeen al indicador

   Moldes aceptables para indicadores (placeholders — NO los copies; reemplaza con texto literal del bullet real):
     - "<INDICADOR> <parámetro numérico literal del bullet>"
     - "<INDICADOR> <timeframe literal del bullet>"
     - "<INDICADOR> <umbral o condición literal del bullet>"
     - "<término-compuesto-completo tal como figura en el bullet>"
     - "<4+ palabras consecutivas literales del bullet que incluyen al indicador>"

   PROHIBIDO (el aplicador los rechaza por ambigüedad, sin excepción):
     - "MACD", "RSI", "ADX", "EMA", "MM", "OBV", "VPVR", "Stochastic", "Ichimoku"
     - "Divergencia", "Volumen", "Tendencia", "Lateral", "Short", "Long", "Breakout", "Rebote", "Manipulación"
     - Cualquier nombre de indicador o término genérico SIN parámetro/timeframe/umbral/condición/contexto específico del bullet que lo contiene

   Si ningún bullet del CEREBRO permite armar un target_key con al menos uno de los anclajes de arriba, la salida correcta es "add" con bullet nuevo o simplemente OMITIR la op. NUNCA emitas el término genérico pelón.

5. **Si NO puedes identificar una subfrase distintiva para una línea existente**, tienes DOS salidas seguras:
   - Usar "add" con un bullet nuevo bien específico que incorpore el detalle del nuevo video (preferido cuando el matiz es importante).
   - Simplemente OMITIR esa op (preferido cuando el concepto no aporta).
   Esto también aplica cuando el bullet parece existir pero NO puedes citar 4+ palabras consecutivas literales de él: prefiere "add" u omitir antes que inventar una frase parecida o copiar un ejemplo de este prompt.
   NUNCA mandes un target_key genérico esperando que matchee: el aplicador local va a rechazar la op por ambigüedad y el esfuerzo se pierde. NUNCA mandes un target_key "inventado" creyendo que se parece al bullet: el aplicador va a reportar target_missing y la op se pierde. MEJOR omitir que enviar un target_key ambiguo o inventado.

6. "video_sources_to_append" DEBE tener exactamente una entrada por cada nuevo video del bloque, en el mismo orden, con formato "YYYY-MM-DD: título corto". No añadas más ni menos.

7. Si una sección no cambia, devuelve su clave con array vacío []. No omitas ninguna clave del esquema.

8. Sé MUY conservador con "add". Prefiere "increment_evidence" / "merge" cuando haya un target_key DISTINTIVO obvio; si no lo hay, "add" es la salida correcta.
   Sé todavía más conservador con bullets de Tickers/Activos: no conviertas snapshots de precio o sesgos del día en conocimiento permanente salvo que expresen una regla reusable.

9. Primer carácter `{`. Último `}`. Sin texto antes ni después. Sin ```json.

EJEMPLO DE RESPUESTA VÁLIDA con PLACEHOLDERS (los `<...>` son MOLDES — en tu respuesta real reemplázalos con texto LITERAL tomado de los bullets del CEREBRO ACTUAL que te paso abajo; NO dejes `<...>` en tu JSON):
{"profile_updates":[],"indicator_updates":[{"action":"increment_evidence","target_key":"<subfrase-literal-4+-palabras-del-bullet-del-indicador-en-tu-CEREBRO>","evidence_count_delta":2},{"action":"add","content":"- **<Indicador nuevo real>**: <descripción específica tomada del nuevo video>"}],"setup_updates":[{"action":"merge","target_key":"<subfrase-literal-4+-palabras-del-bullet-del-setup-en-tu-CEREBRO>","content":"<matiz nuevo del resumen actual, <=15 palabras>"}],"risk_updates":[],"psychology_updates":[],"ticker_updates":[{"action":"increment_evidence","target_key":"<TICKER + 4+ palabras de contexto literal del bullet de ticker en tu CEREBRO>","evidence_count_delta":1}],"pattern_updates":[],"video_sources_to_append":["YYYY-MM-DD: <título corto video 1>","YYYY-MM-DD: <título corto video 2>"]}

RECORDATORIO: los `<...>` de arriba son placeholders. En tu JSON real NO aparecen angle brackets; en su lugar va texto literal copiado del CEREBRO ACTUAL y del nuevo resumen.

CONTRAEJEMPLO (NO hagas esto — target_keys ambiguos, inventados, o copiados de este prompt; el aplicador va a rechazar por ambigüedad o reportar target_missing):
{"indicator_updates":[{"action":"increment_evidence","target_key":"ADX","evidence_count_delta":2},{"action":"increment_evidence","target_key":"MACD","evidence_count_delta":3},{"action":"increment_evidence","target_key":"Divergencia","evidence_count_delta":2},{"action":"increment_evidence","target_key":"ADX valor <23 indica lateral","evidence_count_delta":1}],"setup_updates":[{"action":"merge","target_key":"breakout del rango lateral en 4H con volumen","content":"..."}],"ticker_updates":[{"action":"increment_evidence","target_key":"BTC","evidence_count_delta":3},{"action":"merge","target_key":"**ETH**","content":"..."},{"action":"increment_evidence","target_key":"\"XRP\"","evidence_count_delta":1},{"action":"increment_evidence","target_key":"Oro/PAXG long tras rebote VPVR","evidence_count_delta":1}]}
(Problemas del contraejemplo: "ADX", "MACD", "Divergencia", "BTC", "**ETH**", "\"XRP\"" son términos pelones o decorados → AMBIGUOUS. "ADX valor <23...", "breakout del rango lateral...", "Oro/PAXG long tras rebote..." son frases de ESTE prompt, no de tu CEREBRO → target_missing. NUNCA copies ninguno de esos patrones.)
"""


# ---------- CEREBRO parsing / serialization ----------

class ParsedBrain:
    def __init__(self, header: str, sections: list):
        self.header = header  # text before the first "## " block
        self.sections = sections  # list[(title_without_##, list[str] body)]

    def section_index(self, title: str):
        for i, (t, _) in enumerate(self.sections):
            if t.strip() == title.strip():
                return i
        return None


def _strip_trailing_blanks(lines: list) -> list:
    while lines and lines[-1].strip() == "":
        lines.pop()
    while lines and lines[0].strip() == "":
        lines.pop(0)
    return lines


def parse_brain(text: str) -> ParsedBrain:
    lines = text.splitlines()
    first_h2 = None
    for i, line in enumerate(lines):
        if line.startswith("## "):
            first_h2 = i
            break
    if first_h2 is None:
        return ParsedBrain(text if text.endswith("\n") else text + "\n", [])
    header = "\n".join(lines[:first_h2]).rstrip() + "\n"
    sections = []
    current_title = None
    current_body: list = []
    for line in lines[first_h2:]:
        if line.startswith("## "):
            if current_title is not None:
                sections.append((current_title, _strip_trailing_blanks(current_body)))
            current_title = line[3:].strip()
            current_body = []
        else:
            current_body.append(line)
    if current_title is not None:
        sections.append((current_title, _strip_trailing_blanks(current_body)))
    return ParsedBrain(header, sections)


def serialize_brain(brain: ParsedBrain) -> str:
    out = [brain.header.rstrip() + "\n"]
    for title, body in brain.sections:
        out.append(f"\n## {title}\n")
        if body:
            out.append("\n".join(body) + "\n")
    return "".join(out).rstrip() + "\n"


# ---------- normalization + bullet matching ----------

def _strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def _normalize(s: str) -> str:
    s = (s.replace("\u2019", "'").replace("\u2018", "'")
          .replace("\u201C", '"').replace("\u201D", '"')
          .replace("\u2013", "-").replace("\u2014", "-"))
    s = _strip_accents(s).lower()
    s = re.sub(r"\*+", "", s)
    s = s.lstrip("- \t")
    return s


def is_bullet(line: str) -> bool:
    stripped = line.lstrip()
    return stripped.startswith("- ") or stripped.startswith("-\t") or stripped == "-"


def is_placeholder(line: str) -> bool:
    stripped = line.strip()
    for pat in PLACEHOLDER_PATTERNS:
        if re.match(pat, stripped):
            return True
    return False


def find_bullet_matches(lines: list, target_key: str) -> list:
    """Return ALL bullet indices whose normalized text contains the normalized
    target_key. Empty target → empty list. Used by apply_patch to detect
    ambiguity: 0 matches → target_missing, 1 → apply, 2+ → ambiguous (skip).
    """
    needle = _normalize(target_key or "")
    if not needle:
        return []
    hits = []
    for i, line in enumerate(lines):
        if not is_bullet(line):
            continue
        if needle in _normalize(line):
            hits.append(i)
    return hits


def find_bullet_by_key(lines: list, target_key: str):
    """Legacy single-result variant. Retained for external unit tests and for
    callers that already proved uniqueness. apply_patch uses find_bullet_matches
    directly so it can detect ambiguity and skip the op."""
    hits = find_bullet_matches(lines, target_key)
    return hits[0] if len(hits) == 1 else (hits[0] if hits else None)


COUNTER_RE = re.compile(r"\(visto en (\d+) videos?\)")


def bump_counter(line: str, delta: int) -> str:
    if delta <= 0:
        return line
    m = COUNTER_RE.search(line)
    if m:
        new = int(m.group(1)) + delta
        return line[:m.start()] + f"(visto en {new} videos)" + line[m.end():]
    # No counter → the existing line is 1 evidence by itself.
    new = 1 + delta
    return line.rstrip() + f" (visto en {new} videos)"


def remove_placeholders(lines: list) -> list:
    return [l for l in lines if not is_placeholder(l)]


# ---------- schema validation + apply ----------

class ApplyReport:
    def __init__(self):
        self.applied = 0
        self.target_missing = 0
        self.sections_missing = 0
        self.invalid_ops = 0            # shape/action/target_key/content/delta wrong
        self.ambiguous_targets = 0      # target_key matched 2+ bullets — skipped for safety
        self.total_ops = 0              # total section ops seen (excludes video_sources)
        self.video_sources_added = 0
        self.video_sources_invalid = 0  # entries rejected (not str / empty)
        self.details: list = []

    def as_dict(self) -> dict:
        # skipped_ops = every op that did NOT mutate the brain, regardless of why.
        # It's a convenience sum for readers; individual counters still carry the
        # specific reason (invalid shape / target missing / ambiguous / section missing).
        skipped_ops = (self.invalid_ops + self.target_missing
                       + self.ambiguous_targets + self.sections_missing)
        return {
            "applied": self.applied,
            "target_missing": self.target_missing,
            "sections_missing": self.sections_missing,
            "invalid_ops": self.invalid_ops,
            "ambiguous_targets": self.ambiguous_targets,
            "skipped_ops": skipped_ops,
            "total_ops": self.total_ops,
            "video_sources_added": self.video_sources_added,
            "video_sources_invalid": self.video_sources_invalid,
        }


def structural_validate_patch(patch: dict) -> list:
    """Flag only STRUCTURAL problems that make the patch un-applyable as a whole
    (wrong top-level shape). Per-op issues are tolerated and counted separately
    during apply — one bad op must not abort the whole chunk.
    """
    errors: list = []
    for k in JSON_KEY_TO_SECTION.keys():
        v = patch.get(k)
        if v is None:
            continue  # missing key tolerated — treated as no ops
        if not isinstance(v, list):
            errors.append(f"{k} must be a list, got {type(v).__name__}")
    vids = patch.get("video_sources_to_append")
    if vids is not None and not isinstance(vids, list):
        errors.append("video_sources_to_append must be a list")
    return errors


def _op_validation_error(op) -> str:
    """Return a short reason string if the op is individually invalid, or '' if OK.
    Kept close to the OpItem schema in DELTA_PROMPT. Permissive on extra fields.
    """
    if not isinstance(op, dict):
        return f"not an object: {type(op).__name__}"
    action = op.get("action")
    if action not in VALID_ACTIONS:
        return f"unknown action: {action!r}"
    if action in ("merge", "increment_evidence", "note_contradiction"):
        tk = op.get("target_key")
        if not isinstance(tk, str) or not tk.strip():
            return f"{action}: empty/missing target_key"
    if action in ("add", "merge", "note_contradiction"):
        c = op.get("content")
        if not isinstance(c, str) or not c.strip():
            return f"{action}: empty/missing content"
    if action == "increment_evidence":
        d = op.get("evidence_count_delta")
        if not isinstance(d, int) or d <= 0:
            return f"increment_evidence: non-positive evidence_count_delta={d!r}"
    return ""


def apply_patch(brain: ParsedBrain, patch: dict) -> ApplyReport:
    report = ApplyReport()

    for json_key, section_title in JSON_KEY_TO_SECTION.items():
        ops = patch.get(json_key, []) or []
        if not ops:
            continue
        report.total_ops += len(ops)
        idx = brain.section_index(section_title)
        if idx is None:
            report.sections_missing += len(ops)
            report.details.append(f"section '{section_title}' missing; skipped {len(ops)} ops")
            continue
        _, lines = brain.sections[idx]

        for op in ops:
            # Per-op validation: any individual failure is skipped and counted;
            # it must NOT abort the rest of the chunk.
            reason = _op_validation_error(op)
            if reason:
                report.invalid_ops += 1
                report.details.append(f"{section_title}: invalid op skipped — {reason}")
                continue

            action = op["action"]
            if action == "add":
                content = op["content"].strip()
                if not content.startswith("-"):
                    content = f"- {content}"
                lines = remove_placeholders(lines)
                lines.append(content)
                report.applied += 1

            elif action == "increment_evidence":
                tk = op["target_key"]
                delta = op["evidence_count_delta"]
                matches = find_bullet_matches(lines, tk)
                if len(matches) == 0:
                    report.target_missing += 1
                    report.details.append(
                        f"{section_title}: increment_evidence target {tk!r} not found")
                    continue
                if len(matches) > 1:
                    report.ambiguous_targets += 1
                    report.details.append(
                        f"{section_title}: increment_evidence target {tk!r} matched "
                        f"{len(matches)} bullets — skipped (ambiguous)")
                    continue
                pos = matches[0]
                lines[pos] = bump_counter(lines[pos], delta)
                report.applied += 1

            elif action == "merge":
                tk = op["target_key"]
                extra = op["content"].strip()
                matches = find_bullet_matches(lines, tk)
                if len(matches) == 0:
                    report.target_missing += 1
                    report.details.append(f"{section_title}: merge target {tk!r} not found")
                    continue
                if len(matches) > 1:
                    report.ambiguous_targets += 1
                    report.details.append(
                        f"{section_title}: merge target {tk!r} matched "
                        f"{len(matches)} bullets — skipped (ambiguous)")
                    continue
                pos = matches[0]
                line = lines[pos].rstrip()
                m = COUNTER_RE.search(line)
                if m:
                    lines[pos] = (line[:m.start()].rstrip()
                                  + "; " + extra + " " + line[m.start():])
                else:
                    lines[pos] = line + "; " + extra
                report.applied += 1

            elif action == "note_contradiction":
                tk = op["target_key"]
                note = op["content"].strip()
                matches = find_bullet_matches(lines, tk)
                if len(matches) == 0:
                    report.target_missing += 1
                    report.details.append(
                        f"{section_title}: note_contradiction target {tk!r} not found")
                    continue
                if len(matches) > 1:
                    report.ambiguous_targets += 1
                    report.details.append(
                        f"{section_title}: note_contradiction target {tk!r} matched "
                        f"{len(matches)} bullets — skipped (ambiguous)")
                    continue
                pos = matches[0]
                if not (note.startswith("(") and note.endswith(")")):
                    note = f"({note})"
                lines[pos] = lines[pos].rstrip() + " " + note
                report.applied += 1

        brain.sections[idx] = (section_title, lines)

    # Video sources — same per-entry tolerance: drop malformed entries, count them,
    # keep the rest.
    videos = patch.get("video_sources_to_append", []) or []
    if videos:
        idx = brain.section_index("Videos fuente procesados")
        if idx is None:
            report.sections_missing += len(videos)
            report.details.append("section 'Videos fuente procesados' missing")
        else:
            _, vlines = brain.sections[idx]
            vlines = remove_placeholders(vlines)
            for v in videos:
                if not isinstance(v, str) or not v.strip():
                    report.video_sources_invalid += 1
                    report.details.append("video_sources: empty or non-string entry skipped")
                    continue
                v = v.strip()
                bullet = v if v.startswith("-") else f"- {v}"
                vlines.append(bullet)
                report.video_sources_added += 1
            brain.sections[idx] = ("Videos fuente procesados", vlines)

    return report


def atomic_write(path: str, content: str) -> None:
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


# ---------- summary reading ----------

def read_summary_from_md(md_path: str):
    with open(md_path, "r", encoding="utf-8") as f:
        content = f.read()
    title = "Unknown"
    date = "unknown-date"
    if content.startswith("---\n"):
        end = content.find("\n---\n", 4)
        if end != -1:
            for line in content[:end].split("\n"):
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


def _norm_label(s: str) -> str:
    return (s.replace("\u2019", "'").replace("\u2018", "'")
             .replace("\u201C", '"').replace("\u201D", '"')
             .replace("\u2013", "-").replace("\u2014", "-")
             .lower())


def already_in_brain(current_brain: str, video_label: str) -> bool:
    nb = _norm_label(current_brain)
    nl = _norm_label(video_label)
    date_prefix = video_label.split(":", 1)[0].strip()
    title_start = _norm_label(video_label.split(":", 1)[1].strip()[:30]) if ":" in video_label else ""
    return (
        nl in nb
        or (bool(date_prefix) and bool(title_start)
            and f"{date_prefix}:" in current_brain
            and title_start in nb)
    )


# ---------- JSON extraction ----------

def extract_json(raw: str) -> Any:
    raw = raw.strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    # Strip ```json ... ``` fences
    m = re.search(r"```(?:json)?\s*(\{.*\})\s*```", raw, re.DOTALL)
    if m:
        return json.loads(m.group(1))
    # Fallback: first { to last }
    start = raw.find("{")
    end = raw.rfind("}")
    if start != -1 and end != -1 and end > start:
        return json.loads(raw[start:end + 1])
    raise json.JSONDecodeError("No JSON object found in response", raw, 0)


# ---------- main ----------

def run(channel_dir: str, summary_files: list) -> None:
    t0 = time.perf_counter()
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

    t_br = time.perf_counter()
    if os.path.isfile(brain_path):
        brain_size_before = os.path.getsize(brain_path)
        with open(brain_path, "r", encoding="utf-8") as f:
            current_brain = f.read()
        action = "updated"
    else:
        brain_size_before = 0
        current_brain = EMPTY_BRAIN_TEMPLATE
        action = "created"
    log("brain_read",
        f"done in {(time.perf_counter() - t_br) * 1000:.1f}ms "
        f"action={action} cerebro_bytes_before={brain_size_before}")

    brain = parse_brain(current_brain)
    missing = [s for s in SECTIONS_ORDER if brain.section_index(s) is None]
    if missing:
        emit({"type": "error",
              "message": (f"CEREBRO.md is missing required sections: {missing}. "
                          f"Aborting. Use update_brain_batch.py as fallback.")})
        sys.exit(1)

    emit({"type": "progress",
          "message": f"Reading {len(summary_files)} summary file(s)..."})
    new_entries = []
    skipped_known = []
    for path in summary_files:
        summary_text, video_label = read_summary_from_md(path)
        if len(summary_text) < 100:
            emit({"type": "error", "message": f"Summary too short: {path}"})
            sys.exit(1)
        if already_in_brain(current_brain, video_label):
            skipped_known.append((path, video_label))
            continue
        new_entries.append((path, video_label, summary_text))

    total_summary_chars = sum(len(s) for _, _, s in new_entries)
    log("summary_read",
        f"total={len(summary_files)} new={len(new_entries)} "
        f"already_in_brain={len(skipped_known)} total_summary_chars={total_summary_chars}")

    if not new_entries:
        total_ms = (time.perf_counter() - t0) * 1000
        emit({"type": "progress", "message": "All videos already in brain, skipping."})
        emit({
            "type": "result",
            "mode": "delta",
            "brain_file": brain_path,
            "action": "skipped",
            "total_files": len(summary_files),
            "processed_files": 0,
            "skipped_files": len(skipped_known),
            "cerebro_bytes_before": brain_size_before,
            "cerebro_bytes_after": brain_size_before,
            "delta_bytes": 0,
            "prompt_bytes": 0,
            "response_bytes": 0,
            "claude_ms": 0,
            "apply_ms": 0,
            "duration_ms": round(total_ms, 1),
            "apply_report": {"applied": 0, "target_missing": 0, "sections_missing": 0, "video_sources_added": 0},
        })
        return

    blocks = []
    for i, (_, label, summary) in enumerate(new_entries, 1):
        blocks.append(f"### Nuevo resumen {i} (video: {label})\n\n{summary}")
    new_block = "\n\n".join(blocks)
    full_prompt = (
        f"{DELTA_PROMPT}\n\n"
        f"---\nCEREBRO ACTUAL (solo referencia, no lo reescribas):\n\n{current_brain}\n\n"
        f"---\nBLOQUE DE {len(new_entries)} NUEVOS RESÚMENES:\n\n{new_block}\n\n"
        f"---\nResponde SOLO con el JSON del esquema. Primer carácter `{{`, último `}}`."
    )
    prompt_bytes = len(full_prompt.encode("utf-8"))

    claude_bin = find_claude()
    # Delta output is small → shorter timeout. Scale gently.
    timeout_s = min(600, 180 + max(0, len(new_entries) - 1) * 30)
    log("claude",
        f"bin={claude_bin} prompt_bytes={prompt_bytes} timeout_s={timeout_s} "
        f"files={len(new_entries)} — invoking CLI...")
    emit({"type": "progress",
          "message": f"Calling Claude (delta JSON) for {len(new_entries)} video(s)..."})

    t_cl = time.perf_counter()
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

    claude_ms = (time.perf_counter() - t_cl) * 1000
    response_bytes = len(proc.stdout.encode("utf-8"))
    log("claude",
        f"done in {claude_ms:.1f}ms rc={proc.returncode} response_bytes={response_bytes}")

    if proc.returncode != 0:
        emit({"type": "error",
              "message": f"claude returned {proc.returncode}: {proc.stderr[:300]}"})
        sys.exit(1)

    raw = proc.stdout.strip()
    # Persist raw response for debugging (best-effort).
    try:
        with open(os.path.join(channel_dir, ".last_delta_response.json"), "w", encoding="utf-8") as f:
            f.write(raw)
    except OSError:
        pass

    try:
        patch = extract_json(raw)
    except json.JSONDecodeError as e:
        emit({"type": "error",
              "message": (f"Claude response is not valid JSON: {e}. "
                          f"First 200 chars: {raw[:200]!r}. "
                          f"Fallback: run update_brain_batch.py.")})
        sys.exit(1)

    if not isinstance(patch, dict):
        emit({"type": "error",
              "message": (f"Claude JSON is not an object (got {type(patch).__name__}). "
                          f"Fallback: run update_brain_batch.py.")})
        sys.exit(1)

    errs = structural_validate_patch(patch)
    if errs:
        emit({"type": "error",
              "message": ("Structural patch error: " + "; ".join(errs[:5])
                          + ". Fallback: run update_brain_batch.py.")})
        sys.exit(1)

    t_ap = time.perf_counter()
    report = apply_patch(brain, patch)
    apply_ms = (time.perf_counter() - t_ap) * 1000

    log("apply",
        f"done in {apply_ms:.1f}ms applied={report.applied} "
        f"invalid_ops={report.invalid_ops} "
        f"target_missing={report.target_missing} "
        f"ambiguous_targets={report.ambiguous_targets} "
        f"sections_missing={report.sections_missing} "
        f"total_ops={report.total_ops} "
        f"video_sources_added={report.video_sources_added} "
        f"video_sources_invalid={report.video_sources_invalid}")
    for d in report.details[:10]:
        log("apply_detail", d)

    # Global-abort criterion: the patch had section ops but ZERO actually landed
    # in the brain. Covers "all invalid shape", "all targets missing", "all
    # targets ambiguous", and "section-missing wipeout". One or a few bad ops
    # never abort — only a total wipeout (applied==0 despite total_ops>0) does.
    # Ambiguity intentionally counts as "did not apply" so a chunk where Claude
    # points every op at the wrong key still triggers fallback.
    total_section_ops = report.total_ops
    if total_section_ops > 0 and report.applied == 0:
        emit({"type": "error",
              "message": (f"All {total_section_ops} section ops failed to land "
                          f"(invalid={report.invalid_ops}, "
                          f"target_missing={report.target_missing}, "
                          f"ambiguous={report.ambiguous_targets}, "
                          f"sections_missing={report.sections_missing}). "
                          f"Refusing to write. Fallback: run update_brain_batch.py.")})
        sys.exit(1)

    if report.video_sources_added != len(new_entries):
        log("warn",
            f"expected {len(new_entries)} video sources appended, got {report.video_sources_added}")

    new_content = serialize_brain(brain)
    new_bytes = len(new_content.encode("utf-8"))

    if brain_size_before > 0 and new_bytes < brain_size_before * 0.8:
        emit({"type": "error",
              "message": (f"Refusing to overwrite CEREBRO: new size {new_bytes}B < 80% of "
                          f"original {brain_size_before}B. Fallback: run update_brain_batch.py.")})
        sys.exit(1)

    t_wr = time.perf_counter()
    atomic_write(brain_path, new_content)
    write_ms = (time.perf_counter() - t_wr) * 1000
    delta_bytes = new_bytes - brain_size_before
    log("write",
        f"done in {write_ms:.1f}ms cerebro_bytes_after={new_bytes} delta_bytes={delta_bytes:+d}")

    total_ms = (time.perf_counter() - t0) * 1000
    claude_pct = (claude_ms / total_ms * 100) if total_ms > 0 else 0
    log("done",
        f"total {total_ms:.1f}ms (claude {claude_ms:.1f}ms = {claude_pct:.1f}%, "
        f"apply {apply_ms:.1f}ms)")

    emit({"type": "progress",
          "message": f"Brain {action} via delta patch ({len(new_entries)} video(s))."})
    emit({
        "type": "result",
        "mode": "delta",
        "brain_file": brain_path,
        "action": action,
        "total_files": len(summary_files),
        "processed_files": len(new_entries),
        "skipped_files": len(skipped_known),
        "cerebro_bytes_before": brain_size_before,
        "cerebro_bytes_after": new_bytes,
        "delta_bytes": delta_bytes,
        "prompt_bytes": prompt_bytes,
        "response_bytes": response_bytes,
        "claude_ms": round(claude_ms, 1),
        "apply_ms": round(apply_ms, 1),
        "duration_ms": round(total_ms, 1),
        "apply_report": report.as_dict(),
    })


if __name__ == "__main__":
    if len(sys.argv) < 3:
        emit({"type": "error",
              "message": "Usage: update_brain_delta.py <channel_dir> <summary_file_1> [...]"})
        sys.exit(1)
    run(sys.argv[1], sys.argv[2:])
