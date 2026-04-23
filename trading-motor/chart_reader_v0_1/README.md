# chart_reader v0.1 (iteración correctiva)

Primer evaluador de gráficos que consume la capa de reglas
`~/Documents/trading-knowledge/TradingLatino/reglas_operativas.json` (v2.1) y
emite una decisión operativa sobre un `MarketSnapshot` estructurado.

## Iteración correctiva (2026-04-21)

Alineaciones entre código y reglas antes de arrancar pruebas reales:

1. **R:R mínimo — política explícita**: si `risk_plan.rr_ratio < MotorConfig.rr_min`
   (default 2.0 desde R004), la decisión es `no_trade` con `R004` en
   `blocking_rule_ids`. No se permite `enter_long` con R:R insuficiente.
2. **R002 validación real**: `_validate_R002` verifica que el `risk_plan` tenga
   `stop_loss_price` y `stop_loss_pct` utilizables (>0, ≤25%, del lado correcto
   respecto a entry). Si falla, bloquea con R002.
3. **Thresholds desde `operational_definitions`**: `MotorConfig.from_rules()`
   extrae `swing_n`, `range_min_amplitude_pct`, `range_min_tests`,
   `mecha_threshold` y `narrow_range_pct` directamente de la capa de reglas
   (con un `source` map que documenta el origen de cada valor).
4. **B005 activo como precautionary guard**: cuando `symbol` comienza con BTC y
   `1W` clasifica como `tendencial_alcista`, B005 aparece en
   `applicable_rule_ids` y en el `reasoning_chain`. Queda *dormant* respecto a
   bloqueo real (v0.1 no propone shorts) pero expone el hook público
   `Evaluator.short_intent_blocked_by_B005(snapshot)` para v0.2.
5. **TP proyección canónica**: el TP ahora se calcula como `broken_high +
   2×leg` (medida completa de pierna onda C→breakout). Antes usaba
   `rr_min×leg`, lo que hacía que `rr == rr_min` por construcción y la
   validación R004 fuera ineficaz.
6. **R004 añadida al subset v0.1** en `reglas_operativas.json` (cambio mínimo
   en recommended_v0_1_rule_ids). El motor la ejecuta como bloqueador duro.

## Qué hace

Dado un snapshot con OHLCV + indicadores por timeframe, devuelve:

```
Decision(
    regime,                   # tendencial_alcista | bajista | lateral | tejoden | indefinido
    regime_per_tf,            # {"1W": "...", "1D": "...", "4H": "..."}
    decision,                 # enter_long | enter_short | scale_in | scale_out
                              # | exit_position | no_trade | wait | hedge
    confidence,               # 0.0 - 1.0
    applicable_rule_ids,      # reglas que habilitan la decisión (v2.1)
    blocking_rule_ids,        # reglas que la bloquean
    reasoning_chain,          # trazado paso a paso con [RULE_ID]
    conditional_setups,       # "sí habría setup SI pasa X"
    risk_plan                 # SL, TP, apalancamiento, R:R, tamaño
)
```

## Reglas usadas (14 del subset v0.1)

El motor lee el subset directamente del JSON
(`recommended_v0_1_rule_ids`). No hay lista hardcoded.

| ID | priority | action_type | rol en el motor |
|---|---|---|---|
| C001 | primary_context | state_update | clasifica régimen por TF (ADX + MM55) |
| C002 | primary_context | state_update | alineación 1W+1D |
| C003 | primary_context | decision | detecta tejoden → `wait` + conditional |
| S001 | primary_setup | decision | pauta plana ABC long 4H |
| T003 | trigger | decision | ruptura tras cierre + volumen |
| I002 | exit_rule | decision | BOS bajista 4H con volumen |
| I003 | hard_blocker | decision | cooldown post-stop (config) |
| I007 | exit_rule | decision | fake breakout detectado |
| R001 | risk_rule | precondition | leverage cap por categoría |
| R002 | hard_blocker | precondition | valida SL del risk_plan |
| R003 | risk_rule | precondition | SL sizing por perfil (2% BTC 4H) |
| **R004** | risk_rule | precondition | **R:R mínimo 1:2 (NUEVA en v0.1)** |
| E001 | exit_rule | decision | trailing manual escalonado |
| B005 | blocker | decision | no short BTC vs 1W alcista (wired; dormant en v0.1) |

## Arquitectura

```
chart_reader_v0_1/
├── __init__.py
├── types.py              Bar, Indicators, TimeframeData, MarketSnapshot,
│                         Decision, ConditionalSetup, RiskPlan
├── rules_loader.py       RuleSet con índice por id/priority y v0.1 subset
├── swings.py             detect_swings, classify_structure (HH/HL/LH/LL),
│                         last_significant_swing
├── structure.py          detect_range, detect_bos, detect_fake_breakout,
│                         detect_retest, detect_tejoden + RangeBounds
├── evaluator.py          Evaluator (evalúa reglas por priority rank)
├── fixtures/
│   ├── enter_long_abc.json
│   ├── no_trade_cooldown.json
│   └── wait_conditional.json
└── tests/
    └── test_motor.py     7 tests (swings, structure, 3 escenarios e2e)
```

Zero deps externas — solo stdlib (dataclasses, json, unittest).

## Flujo del evaluator (priority-ordered)

1. **C001** — clasifica régimen por cada TF presente
2. **I003** (hard_blocker) — cooldown post-stop: si `last_stop_timestamp` < `config.cooldown_ms_post_stop` → `no_trade`
3. **C002** — alineación 1W+1D; si divergen marca el setup como no-direccional
4. **C003** — busca tejoden en 4H → si sí, `wait` con `conditional_setups`
5. **I002 / I007** (con posición abierta) — invalidaciones: `exit_position`
6. **B005** — precautionary guard se expone en reasoning_chain si BTC + 1W alcista (dormant en v0.1)
7. **S001** — pauta plana ABC en 4H (onda C tocó MM55+POC en últimos `config.s001_lookback_bars` bars + onda C resuelta al alza + ADX sin pendiente bajista fuerte)
8. **T003** — ruptura tras cierre > swing_high con volumen >= SMA20
9. Build `risk_plan` — entry al nivel roto + buffer; SL tactical 2%; TP = `broken_high + 2×leg`
10. **R002** — `_validate_R002` real: verifica stop_loss_price presente, positivo, ≤25%, del lado correcto. Si no, `no_trade`.
11. **R004** — `rr_ratio >= config.rr_min`. Si no, `no_trade` con R004 en `blocking_rule_ids`.
12. **R001 / R003** — leverage cap + SL sizing (ya reflejados en risk_plan)
13. **E001** — plan de trailing escalonado en reasoning_chain

Si no hay trigger: el motor emite `wait` + `conditional_setups` con watch_levels concretos.

## Uso

```python
from chart_reader_v0_1 import Evaluator, MarketSnapshot, TimeframeData, Bar, Indicators

evaluator = Evaluator()  # carga reglas desde path default
snapshot = MarketSnapshot(
    symbol="BTC-USDT",
    as_of=1776830400000,
    timeframes={
        "1W": TimeframeData("1W", bars=[], indicators=Indicators(mm55=65000, mm55_prev=64500, adx=28, adx_prev=26)),
        "1D": TimeframeData("1D", bars=[], indicators=Indicators(mm55=68000, mm55_prev=67600, adx=25, adx_prev=24)),
        "4H": TimeframeData("4H", bars=[...], indicators=Indicators(mm55=70500, poc=71000, atr=900, volume_sma20=1050, ...)),
    },
    flags={"position_open": False},
)
decision = evaluator.evaluate(snapshot)
print(decision.decision)              # "enter_long" / "wait" / "no_trade" / ...
print(decision.reasoning_chain)       # ["[C001] ...", "[C002] ...", "[S001] ...", ...]
print(decision.conditional_setups)    # [ConditionalSetup(...)] si aplica
```

## Resultados de los 3 escenarios (fixtures)

### `enter_long_abc.json`
```
decision:         enter_long
confidence:       0.7
applicable:       [C001, C002, S001, T003, R001, R003, E001]
risk_plan:        leverage=10x · SL=69250 (2.0%) · TP=78000 · R:R=0.52 · size=6.7%
reasoning:
  [C001] regime 1W/1D/4H = tendencial_alcista
  [C002] 1W y 1D alineados
  [S001] onda C tocó MM55+POC (70750) en últimos 8 bars; último close 75000
  [T003] cierre 75000 > swing_high 74200 con volumen 2200
  [R001/R003] leverage_cap=10, SL=2.0%
  [E001] exit plan: +3%→BE, +7%→+5%, trailing 4-4.5%
```

### `no_trade_cooldown.json`
```
decision:         no_trade
blocking_rules:   [I003]
reasoning:
  [C001] regime tendencial_alcista
  [I003] stop ejecutado hace <4h — cooldown activo, no reentrar
```

### `wait_conditional.json`
```
decision:         wait
applicable:       [C001, C002, S001]
conditional:
  [T003] enter_long cuando vela 4H cierre > 74200 con volumen >= SMA20 · watch=74200
```

## Tests

```bash
cd /Users/openclaw/vigilancia-btc
python3 -m unittest chart_reader_v0_1.tests.test_motor -v
# 7 tests, 0 failures
```

## Política explícita de R:R (R004)

Si el `risk_plan.rr_ratio` calculado no alcanza `MotorConfig.rr_min` (default
2.0 desde R004), el motor devuelve `decision="no_trade"` con `R004` en
`blocking_rule_ids`. Decisión consciente: un setup+trigger válidos con R:R
insuficiente no debe ejecutarse; es trampa estructural.

## Estado de B005

Wired pero **dormant** en v0.1. Cuando `symbol` comienza con BTC y 1W es
`tendencial_alcista`, B005 aparece en `applicable_rule_ids` y en el
`reasoning_chain` como "precautionary guard activo". No bloquea nada activo
porque v0.1 sólo tiene setups long (S001). Para v0.2 (cuando se añada S007
short alt), el método público `Evaluator.short_intent_blocked_by_B005(snap)`
funciona como hook de bloqueo real.

## Thresholds — fuente única: `reglas_operativas.json`

Todo threshold del motor vive en el JSON, en uno de dos bloques:
- **`operational_definitions.*`** — estructura de mercado (swings, rangos)
- **`motor_defaults.*`** — thresholds propios del motor, centralizados

El motor no tiene defaults silenciosos. Si falta `motor_defaults` en el JSON,
`MotorConfig.from_rules()` lanza `ValueError` explícito.

| Campo de `MotorConfig` | Origen en JSON | Valor actual |
|---|---|---|
| `swing_n` | `operational_definitions.swing_high.default_N` | 3 |
| `range_min_amplitude_pct` | `operational_definitions.rango_lateral_confirmado.min_amplitude_pct` | 8.0% |
| `range_min_tests` | `operational_definitions.rango_lateral_confirmado.min_tests_per_extreme` | 2 |
| `narrow_range_pct` | parseado del texto de B010 | 0.5% |
| `fake_breakout_wick_ratio` | `motor_defaults.fake_breakout_wick_ratio.value` | 0.60 |
| `cooldown_ms_post_stop` | `motor_defaults.cooldown_ms_post_stop.value` | 14,400,000 ms (4h) |
| `s001_lookback_bars` | `motor_defaults.s001_lookback_bars.value` | 8 |
| `rr_min` | `motor_defaults.rr_min.value` (→ R004) | 2.0 |
| `tp_leg_multiplier` | `motor_defaults.tp_leg_multiplier.value` | 2.0 |
| `sl_profile` | `motor_defaults.sl_profile.value` (→ R003) | BTC 4H 2%, scalping alt 10%, rango 4.5%, TRX semanal 20% |

Cada entrada trae su `source` documentada en `MotorConfig.source`. Cada campo
de `motor_defaults` incluye su propio `source` y `used_by` dentro del JSON
para trazabilidad bidireccional.

### Política del wick threshold (una sola fuente)

El motor v0.1 usa **UN** solo threshold de mecha: `fake_breakout_wick_ratio = 0.60`,
aplicado por `detect_fake_breakout` y `detect_tejoden`.

El valor `0.70` que aparece en `T002.confirmations` ("pinbar con mecha ≥70%
en el toque") es un threshold de **pinbar-trigger** — concepto distinto al
fake breakout. T002 NO está implementado en v0.1; cuando v0.2 lo implemente,
leerá un campo aparte (`pinbar_wick_ratio`) que se añadirá a `motor_defaults`
entonces. No coexisten dos valores en runtime; sólo uno de los dos conceptos
está activo en v0.1.

El test `test_runtime_mecha_matches_motor_defaults_exactly` asegura que el
valor usado por el runtime es EXACTAMENTE el mismo que está en el JSON.

### Cooldown y lookback — no son magia

- `cooldown_ms_post_stop`: en `motor_defaults`, consumido por `_apply_I003`.
- `s001_lookback_bars`: en `motor_defaults`, consumido por `_check_S001`.
- `tp_leg_multiplier`: en `motor_defaults`, consumido por `_build_risk_plan`.

Tests de coherencia (`TestCoherence` class) mutan estos valores y verifican
que el runtime los respeta — garantizan que no hay números mágicos sueltos
en el código.

## Limitaciones conocidas (aceptables para v0.1)

1. **No hay detector de divergencias** (RSI/MACD vs precio). S001 asume
   "sin divergencia bajista fuerte" pero no la calcula. v0.2.
2. **POC/VAH/VAL como input**: el motor los recibe ya calculados. No los
   deriva del OHLCV + volumen. v0.2.
3. **Indicadores pre-calculados**: MM55, ADX, MACD, RSI, ATR, volume_sma20
   entran como valores ya computados. No hay computador interno.
4. **No hay persistencia**: cada `evaluate()` es stateless. No recuerda
   decisiones previas para detectar "mismo setup reintentado" más allá del
   cooldown I003. v0.2 si hace falta.
5. **TP proyección fija 2×leg** (canónica del setup). No hay detección de
   próxima resistencia intermedia que pueda acortar el TP; podría quedarse
   demasiado optimista en rangos comprimidos. v0.2.
6. **Fake breakout threshold**: se interpreta `60%` como `wick/range` (más
   robusto que `wick/body` que sería `infinity` en dojis). Documentado.
7. **B005 dormant**: por diseño — ver sección arriba.

## Qué faltaría para v0.2

- **Detector de divergencias** (RSI/MACD vs precio) con 2+ picos.
- **TP inteligente**: proyectar medida de pierna previa cuando hay ruptura; usar VAH/VAL/próximo swing_high.
- **Setup S007** (short selectivo en altcoin divergente con BTC alcista) → activa B005 real.
- **Computación interna de POC/VAH/VAL** desde OHLCV + volumen.
- **Detector de retest** integrado en el flujo post-T003 para distinguir "ruptura recién hecha" vs "ruptura retesteada y respetada".
- **Trailing engine** que actualice estado entre evaluaciones (requiere persistencia).
- **Integración con MCP Jackson** (TradingView live) para poblar `MarketSnapshot` automáticamente.
- **Configuración por asset class**: los umbrales actuales están hardcodeados; deberían leerse de un archivo config.
- **Backtesting harness**: alimentar histórico de BTC 4H y medir hit-rate + R:R real vs las 13 reglas.
