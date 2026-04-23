"""Swing detection per operational_definitions (swing_high / swing_low).

A swing_high at index i is a bar whose high is strictly greater than the highs
of N bars before AND after. Symmetric for swing_low. `atr_filter_mult`
optionally discards small swings (altura < atr_filter_mult × atr).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Optional

from .types import Bar


@dataclass
class Swing:
    index: int          # bar index in the original list
    timestamp: int
    price: float
    kind: str           # "high" | "low"


def detect_swings(bars: list[Bar], n: int = 3, atr: Optional[float] = None,
                  atr_filter_mult: float = 0.0) -> list[Swing]:
    """Return ordered list of swing points (highs+lows interleaved by index).

    n: neighbors each side required to qualify.
    atr_filter_mult: if >0, swings whose vertical distance to the previous
        opposite swing is < atr_filter_mult*atr are discarded (noise filter).
    """
    if len(bars) < 2 * n + 1:
        return []
    swings: list[Swing] = []
    for i in range(n, len(bars) - n):
        window = bars[i - n : i + n + 1]
        h = bars[i].high
        l = bars[i].low
        if all(h > b.high for j, b in enumerate(window) if j != n):
            swings.append(Swing(i, bars[i].timestamp, h, "high"))
        if all(l < b.low for j, b in enumerate(window) if j != n):
            swings.append(Swing(i, bars[i].timestamp, l, "low"))
    swings.sort(key=lambda s: s.index)
    if atr and atr_filter_mult > 0:
        filtered: list[Swing] = []
        last_opposite: Optional[Swing] = None
        for s in swings:
            if last_opposite is None or last_opposite.kind == s.kind:
                filtered.append(s)
                last_opposite = s
                continue
            if abs(s.price - last_opposite.price) >= atr_filter_mult * atr:
                filtered.append(s)
                last_opposite = s
        swings = filtered
    return swings


def classify_structure(swings: list[Swing], lookback: int = 4) -> str:
    """Classify the recent swing sequence into HH_HL | LH_LL | mixed | unknown.

    Uses the last `lookback` swings. Needs at least 4 to judge.
    """
    if len(swings) < 4:
        return "unknown"
    recent = swings[-lookback:]
    highs = [s for s in recent if s.kind == "high"]
    lows = [s for s in recent if s.kind == "low"]
    if len(highs) < 2 or len(lows) < 2:
        return "mixed"
    hh = all(highs[i].price > highs[i - 1].price for i in range(1, len(highs)))
    ll = all(lows[i].price < lows[i - 1].price for i in range(1, len(lows)))
    if hh and all(lows[i].price > lows[i - 1].price for i in range(1, len(lows))):
        return "HH_HL"       # bullish structure
    if ll and all(highs[i].price < highs[i - 1].price for i in range(1, len(highs))):
        return "LH_LL"       # bearish structure
    return "mixed"


def last_significant_swing(swings: list[Swing], kind: str) -> Optional[Swing]:
    """Most recent swing of the given kind ('high' | 'low')."""
    for s in reversed(swings):
        if s.kind == kind:
            return s
    return None
