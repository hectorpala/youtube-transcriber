"""Data contracts for chart_reader v0.1.

All inputs/outputs are plain dataclasses so they serialize cleanly to/from JSON.
No pandas/numpy dependency — stdlib only.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Optional


@dataclass
class Bar:
    timestamp: int          # unix ms (close time)
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass
class Indicators:
    """Latest indicator values on the last closed bar of the timeframe.

    All fields optional — missing indicators just reduce which rules can fire.
    adx_prev / mm55_prev allow slope calculation.
    """
    mm55: Optional[float] = None
    mm55_prev: Optional[float] = None
    ema10: Optional[float] = None
    ema20: Optional[float] = None
    adx: Optional[float] = None
    adx_prev: Optional[float] = None
    macd_line: Optional[float] = None
    macd_signal: Optional[float] = None
    macd_hist: Optional[float] = None
    rsi: Optional[float] = None
    atr: Optional[float] = None
    poc: Optional[float] = None
    vah: Optional[float] = None
    val: Optional[float] = None
    volume_sma20: Optional[float] = None   # for breakout confirmation


@dataclass
class TimeframeData:
    timeframe: str                # "1H", "4H", "1D", "1W"
    bars: list[Bar] = field(default_factory=list)     # oldest → newest
    indicators: Indicators = field(default_factory=Indicators)


@dataclass
class MarketSnapshot:
    symbol: str
    as_of: int                    # unix ms
    timeframes: dict[str, TimeframeData] = field(default_factory=dict)
    flags: dict[str, Any] = field(default_factory=dict)
    """Flags (all optional):
      weekend: bool
      exchange_maintenance: bool
      fear_greed: int 0-100
      long_short_ratio: float      # >1 = longs excess
      emotional_ok: bool           # False = trader compromised
      economic_urgency: bool
      last_stop_timestamp: int     # unix ms, for I003 cooldown
      position_open: bool
      position_side: str           # "long" | "short"
      position_entry: float
    """
    portfolio: dict[str, Any] = field(default_factory=dict)


@dataclass
class ConditionalSetup:
    """A setup that would activate IF a specific condition materializes.

    Used to tell the user 'no trade now, but here is what to watch for'.
    """
    rule_id: str
    condition: str                # human-readable, references watch_level when present
    if_triggered_action: str      # "enter_long" | "enter_short" | "exit_position" | ...
    watch_level: Optional[float] = None
    timeframe: Optional[str] = None
    notes: str = ""


@dataclass
class RiskPlan:
    leverage_cap: Optional[int] = None
    stop_loss_pct: Optional[float] = None
    stop_loss_price: Optional[float] = None
    take_profit_price: Optional[float] = None
    rr_ratio: Optional[float] = None
    position_size_pct: Optional[float] = None
    notes: list[str] = field(default_factory=list)


@dataclass
class Context:
    """Clasificación de contexto en 3 capas para un timeframe (v0.2 Fase A).

    Antes de v0.2, C001 colapsaba estas 3 dimensiones en una sola etiqueta
    (`tendencial_alcista | tendencial_bajista | lateral | indefinido`), lo que
    confundía 'pendiente MM55 positiva' con 'setup alcista operable'.

    Las 3 capas separan responsabilidades:
      - macro_bias: sesgo estructural (pendiente MM55 + posición relativa).
      - location_state: dónde está el precio respecto a MM55 (cerca, lejos, etc.).
      - execution_regime: qué FAMILIA de setup es operable AHORA.
    """
    macro_bias: str             # "bull" | "bear" | "neutral"
    location_state: str         # "above_mm55" | "near_mm55" | "below_mm55"
                                # | "stretched_above_mm55" | "stretched_below_mm55"
                                # | "unknown"
    execution_regime: str       # "trend_follow" | "range" | "mean_reversion_candidate"
                                # | "panic_extension" | "indefinido"


# Familias de setup habilitadas tras el filtro multi-TF.
# v0.2 Fase A: C002 ya no bloquea universalmente; marca qué familias operan.
SETUP_FAMILIES = (
    "trend_follow",           # requiere alineación macro_bias multi-TF
    "accumulation",           # permitida cuando macro bear + stretched_below
    "mean_reversion",         # rebote técnico contra-tendencia
    "range_fade",             # compra-abajo / venta-arriba en rango confirmado
    "exit_only",              # sólo invalidaciones/exits; no nuevas posiciones
)


@dataclass
class Decision:
    symbol: str
    as_of: int
    regime: str                                  # per 1D (primary) — back-compat v0.1
    regime_per_tf: dict[str, str] = field(default_factory=dict)  # back-compat v0.1

    # v0.2 Fase A — contexto en 3 capas
    context_per_tf: dict[str, Context] = field(default_factory=dict)
    allowed_setup_families: list[str] = field(default_factory=list)

    decision: str = "no_trade"                   # enter_long|enter_short|scale_in|scale_out|exit_position|no_trade|wait|hedge
    confidence: float = 0.0
    applicable_rule_ids: list[str] = field(default_factory=list)
    blocking_rule_ids: list[str] = field(default_factory=list)
    reasoning_chain: list[str] = field(default_factory=list)
    conditional_setups: list[ConditionalSetup] = field(default_factory=list)
    risk_plan: Optional[RiskPlan] = None

    def to_dict(self) -> dict:
        d = asdict(self)
        if self.risk_plan is None:
            d["risk_plan"] = None
        return d
