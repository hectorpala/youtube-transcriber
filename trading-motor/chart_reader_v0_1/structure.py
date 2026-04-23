"""Structure detectors per operational_definitions v2.1.

- break_of_structure: cuerpo cierra del lado contrario al último swing relevante + volumen.
- fake_breakout: ruptura seguida de cierre de vuelta dentro del rango previo con mechazo >=60%.
- retest_valido: tras ruptura, el precio vuelve al nivel roto y rebota con vela de rechazo.
- rango_lateral_confirmado: >=2 tests por extremo, amplitud mínima.
- tejoden: fake_breakout aplicado a los extremos del rango principal.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from .types import Bar, TimeframeData
from .swings import Swing, last_significant_swing


"""Module-level defaults. Prefer the values held in MotorConfig (built from
operational_definitions in the rules layer). Estas constantes se dejan como
fallback para uso directo sin config.
"""
MECHA_THRESHOLD = 0.60          # >=60% del cuerpo = mecha significativa
MIN_RANGE_AMPLITUDE_PCT = 8.0   # >=8% del precio medio
NARROW_RANGE_THRESHOLD = 0.5    # <0.5% = rango muy estrecho (B010)


def body(bar: Bar) -> float:
    return abs(bar.close - bar.open)


def range_(bar: Bar) -> float:
    return bar.high - bar.low


def upper_wick(bar: Bar) -> float:
    return bar.high - max(bar.open, bar.close)


def lower_wick(bar: Bar) -> float:
    return min(bar.open, bar.close) - bar.low


def wick_ratio_upper(bar: Bar) -> float:
    """Proporción de mecha superior sobre el rango total de la vela.

    Usa range (high-low) como denominador para tolerar velas con body≈0
    (dojis con mecha larga son precisamente las que queremos detectar).
    """
    r = range_(bar)
    if r <= 0:
        return 0.0
    return upper_wick(bar) / r


def wick_ratio_lower(bar: Bar) -> float:
    r = range_(bar)
    if r <= 0:
        return 0.0
    return lower_wick(bar) / r


# ---------------------------------------------------------------------------
# Rango lateral
# ---------------------------------------------------------------------------

@dataclass
class RangeBounds:
    high: float
    low: float
    tests_high: int
    tests_low: int
    amplitude_pct: float

    @property
    def mid(self) -> float:
        return 0.5 * (self.high + self.low)

    @property
    def confirmed(self) -> bool:
        return (self.tests_high >= 2 and self.tests_low >= 2
                and self.amplitude_pct >= MIN_RANGE_AMPLITUDE_PCT)

    @property
    def very_narrow(self) -> bool:
        return self.amplitude_pct < NARROW_RANGE_THRESHOLD


def detect_range(bars: list[Bar], swings: list[Swing], tolerance_pct: float = 0.5) -> Optional[RangeBounds]:
    """Tentative range bounds from recent swings with count of touches.

    tolerance_pct: % of the range above/below each swing considered a "test".
    """
    if len(swings) < 4:
        return None
    highs = [s.price for s in swings if s.kind == "high"]
    lows = [s.price for s in swings if s.kind == "low"]
    if not highs or not lows:
        return None
    h = max(highs)
    l = min(lows)
    if h <= l:
        return None
    amp_pct = (h - l) / ((h + l) / 2) * 100
    tol_h = h * tolerance_pct / 100
    tol_l = l * tolerance_pct / 100
    tests_h = sum(1 for s in swings if s.kind == "high" and abs(s.price - h) <= tol_h)
    tests_l = sum(1 for s in swings if s.kind == "low" and abs(s.price - l) <= tol_l)
    return RangeBounds(high=h, low=l, tests_high=tests_h, tests_low=tests_l, amplitude_pct=amp_pct)


# ---------------------------------------------------------------------------
# Break of Structure (BOS)
# ---------------------------------------------------------------------------

@dataclass
class BOSResult:
    detected: bool
    direction: Optional[str] = None      # "bearish" | "bullish"
    broken_swing_price: Optional[float] = None
    close_price: Optional[float] = None
    volume_confirmed: bool = False

    @property
    def bearish(self) -> bool:
        return self.detected and self.direction == "bearish"


def detect_bos(bars: list[Bar], swings: list[Swing], volume_sma20: Optional[float] = None) -> BOSResult:
    """Bearish BOS: last close below last significant swing_low.
    Bullish BOS: last close above last significant swing_high.
    Volume confirmation: bar volume >= volume_sma20 (if provided).
    """
    if not bars or not swings:
        return BOSResult(detected=False)
    last = bars[-1]
    last_low = last_significant_swing(swings, "low")
    last_high = last_significant_swing(swings, "high")
    vol_ok = True
    if volume_sma20 is not None:
        vol_ok = last.volume >= volume_sma20
    if last_low and last.close < last_low.price:
        return BOSResult(True, "bearish", last_low.price, last.close, vol_ok)
    if last_high and last.close > last_high.price:
        return BOSResult(True, "bullish", last_high.price, last.close, vol_ok)
    return BOSResult(detected=False)


# ---------------------------------------------------------------------------
# Fake breakout
# ---------------------------------------------------------------------------

@dataclass
class FakeBreakoutResult:
    detected: bool
    side: Optional[str] = None           # "upper" | "lower"
    level: Optional[float] = None
    notes: str = ""


def detect_fake_breakout(bars: list[Bar], bounds: Optional[RangeBounds],
                         lookback: int = 3,
                         mecha_threshold: float = MECHA_THRESHOLD) -> FakeBreakoutResult:
    """Search the last `lookback` bars: did one break an extreme and the next
    close back inside with a significant wick?

    mecha_threshold: fracción del rango de la vela (default 0.60). Debe venir
    idealmente de MotorConfig.mecha_threshold (leído de operational_definitions).
    """
    if not bounds or len(bars) < 2:
        return FakeBreakoutResult(False)
    recent = bars[-lookback - 1 :] if len(bars) > lookback else bars
    for i in range(len(recent) - 1):
        br = recent[i]
        nx = recent[i + 1]
        # Upper fake
        if br.high > bounds.high and nx.close < bounds.high:
            if wick_ratio_upper(br) >= mecha_threshold or wick_ratio_upper(nx) >= mecha_threshold:
                return FakeBreakoutResult(True, "upper", bounds.high,
                                          f"breakout bar.high={br.high} next.close={nx.close}")
        # Lower fake
        if br.low < bounds.low and nx.close > bounds.low:
            if wick_ratio_lower(br) >= mecha_threshold or wick_ratio_lower(nx) >= mecha_threshold:
                return FakeBreakoutResult(True, "lower", bounds.low,
                                          f"breakdown bar.low={br.low} next.close={nx.close}")
    return FakeBreakoutResult(False)


# ---------------------------------------------------------------------------
# Retest
# ---------------------------------------------------------------------------

@dataclass
class RetestResult:
    valid: bool
    side: Optional[str] = None        # "support" | "resistance"
    level: Optional[float] = None


def detect_retest(bars: list[Bar], level: float, side: str = "support",
                  lookback: int = 3, tolerance_pct: float = 0.5) -> RetestResult:
    """Was the level revisited and respected in the last `lookback` bars?

    side='support' (level should hold as floor); side='resistance' (cap).
    """
    if not bars:
        return RetestResult(False)
    recent = bars[-lookback:]
    tol = level * tolerance_pct / 100
    for b in recent:
        if side == "support":
            if b.low <= level + tol and b.close > level:
                if wick_ratio_lower(b) >= 0.5:
                    return RetestResult(True, "support", level)
        else:
            if b.high >= level - tol and b.close < level:
                if wick_ratio_upper(b) >= 0.5:
                    return RetestResult(True, "resistance", level)
    return RetestResult(False)


# ---------------------------------------------------------------------------
# Tejoden
# ---------------------------------------------------------------------------

def detect_tejoden(bars: list[Bar], bounds: Optional[RangeBounds],
                   adx: Optional[float], lookback: int = 3,
                   mecha_threshold: float = MECHA_THRESHOLD) -> FakeBreakoutResult:
    """Fake breakout in range extremes WITH weak ADX = tejoden.

    ADX < 23 OR flat on the breakout side confirms weakness.
    """
    fb = detect_fake_breakout(bars, bounds, lookback=lookback,
                              mecha_threshold=mecha_threshold)
    if not fb.detected:
        return fb
    if adx is not None and adx < 23:
        return fb
    if adx is None:
        return fb
    # Strong ADX on the breakout side = real breakout, not tejoden
    return FakeBreakoutResult(False, notes=f"fake breakout detected but ADX={adx} too strong")
