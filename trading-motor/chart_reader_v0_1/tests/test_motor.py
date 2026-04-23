"""Tests for chart_reader v0.1.

Loads the 3 JSON fixtures and asserts the motor produces the expected decision
path. Also includes unit tests for swing detection and structure helpers.

Run: python3 -m unittest chart_reader_v0_1.tests.test_motor
"""

from __future__ import annotations

import json
import os
import sys
import unittest
from pathlib import Path

# Allow running this file both as package (python3 -m unittest ...) and directly.
HERE = Path(__file__).resolve().parent
PKG_ROOT = HERE.parent                       # chart_reader_v0_1/
if str(PKG_ROOT.parent) not in sys.path:
    sys.path.insert(0, str(PKG_ROOT.parent))

from chart_reader_v0_1 import (
    Bar, Indicators, TimeframeData, MarketSnapshot, Evaluator,
)
from chart_reader_v0_1.swings import detect_swings, classify_structure
from chart_reader_v0_1.structure import (
    detect_fake_breakout, detect_bos, detect_range, RangeBounds,
)


FIXTURES_DIR = PKG_ROOT / "fixtures"


def load_snapshot(fixture_name: str) -> tuple[MarketSnapshot, dict]:
    p = FIXTURES_DIR / fixture_name
    with open(p, "r", encoding="utf-8") as f:
        raw = json.load(f)
    snap_data = raw["snapshot"]
    timeframes = {}
    for tf_name, tf in snap_data.get("timeframes", {}).items():
        bars = [Bar(**b) for b in tf.get("bars", [])]
        ind_data = {k: v for k, v in tf.get("indicators", {}).items()
                    if v is not None}
        timeframes[tf_name] = TimeframeData(
            timeframe=tf["timeframe"], bars=bars, indicators=Indicators(**ind_data)
        )
    snapshot = MarketSnapshot(
        symbol=snap_data["symbol"],
        as_of=snap_data["as_of"],
        timeframes=timeframes,
        flags=snap_data.get("flags", {}),
        portfolio=snap_data.get("portfolio", {}),
    )
    return snapshot, raw


# ---------------------------------------------------------------------------
# Unit tests — swing + structure detectors
# ---------------------------------------------------------------------------
class TestSwings(unittest.TestCase):
    def _make_bars(self, highs: list[float], lows: list[float] | None = None) -> list[Bar]:
        if lows is None:
            lows = [h - 1 for h in highs]
        return [
            Bar(timestamp=i * 1000, open=h - 0.5, high=h, low=l, close=h - 0.2, volume=100)
            for i, (h, l) in enumerate(zip(highs, lows))
        ]

    def test_detect_swing_high_and_low(self):
        # mountain-shape: rising then falling → clear swing_high in the middle
        bars = self._make_bars(highs=[1, 2, 3, 4, 5, 4, 3, 2, 1],
                               lows=[0, 1, 2, 3, 4, 3, 2, 1, 0])
        swings = detect_swings(bars, n=3)
        # swing_high at index 4 (price 5)
        self.assertTrue(any(s.kind == "high" and s.price == 5 for s in swings))

    def test_classify_structure_bullish(self):
        # HH/HL pattern: rising lows and highs
        bars = self._make_bars(highs=[2, 5, 4, 7, 6, 9, 8, 11, 10],
                               lows=[1, 3, 3, 5, 5, 7, 7, 9, 9])
        swings = detect_swings(bars, n=1)
        self.assertIn(classify_structure(swings), ["HH_HL", "mixed"])


class TestStructure(unittest.TestCase):
    def test_range_detection(self):
        swings_raw = [(3, "high", 100), (8, "low", 80), (13, "high", 100),
                      (18, "low", 80), (23, "high", 100), (28, "low", 80)]
        from chart_reader_v0_1.swings import Swing
        swings = [Swing(i, i * 1000, p, k) for (i, k, p) in swings_raw]
        # Build enough bars so the function does not short-circuit
        bars = [Bar(i * 1000, 90, 95, 85, 90, 100) for i in range(40)]
        bounds = detect_range(bars, swings, tolerance_pct=1.0)
        self.assertIsNotNone(bounds)
        self.assertEqual(bounds.high, 100)
        self.assertEqual(bounds.low, 80)
        self.assertGreaterEqual(bounds.tests_high, 2)
        self.assertGreaterEqual(bounds.tests_low, 2)
        self.assertTrue(bounds.confirmed)

    def test_fake_breakout_upper(self):
        # Bar that breaks the high with a long upper wick, next bar closes inside
        bounds = RangeBounds(high=100, low=80, tests_high=3, tests_low=3,
                             amplitude_pct=22.2)
        bars = [
            Bar(1, 95, 99, 94, 98, 100),
            Bar(2, 98, 99, 96, 97, 100),
            Bar(3, 97, 102, 96, 97, 100),   # mecha superior, cuerpo ~0 → wick ratio alto
            Bar(4, 97, 98, 93, 94, 120),    # cierra dentro
        ]
        fb = detect_fake_breakout(bars, bounds, lookback=3)
        self.assertTrue(fb.detected)
        self.assertEqual(fb.side, "upper")


# ---------------------------------------------------------------------------
# End-to-end fixture tests
# ---------------------------------------------------------------------------
class TestEvaluator(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.evaluator = Evaluator()

    def test_enter_long_abc(self):
        snap, raw = load_snapshot("enter_long_abc.json")
        dec = self.evaluator.evaluate(snap)
        self.assertEqual(dec.decision, "enter_long",
                         f"Expected enter_long, got {dec.decision}. Reasoning: {dec.reasoning_chain}")
        for rid in ("C001", "S001", "T003", "R001"):
            self.assertIn(rid, dec.applicable_rule_ids,
                          f"Missing rule {rid} in applicable: {dec.applicable_rule_ids}")
        self.assertIsNotNone(dec.risk_plan)
        self.assertIsNotNone(dec.risk_plan.stop_loss_price)
        self.assertIsNotNone(dec.risk_plan.leverage_cap)
        self.assertEqual(dec.risk_plan.leverage_cap, 10)   # BTC cap

    def test_no_trade_cooldown(self):
        snap, raw = load_snapshot("no_trade_cooldown.json")
        dec = self.evaluator.evaluate(snap)
        self.assertEqual(dec.decision, "no_trade",
                         f"Got {dec.decision}, chain: {dec.reasoning_chain}")
        self.assertIn("I003", dec.blocking_rule_ids)

    def test_wait_conditional(self):
        snap, raw = load_snapshot("wait_conditional.json")
        dec = self.evaluator.evaluate(snap)
        self.assertEqual(dec.decision, "wait",
                         f"Got {dec.decision}, chain: {dec.reasoning_chain}")
        # at least one conditional pointing to a watch_level
        self.assertTrue(any(c.watch_level is not None for c in dec.conditional_setups),
                        f"No conditional watch_levels in {dec.conditional_setups}")
        # And at least one T003-class conditional
        self.assertTrue(any("T003" in c.rule_id for c in dec.conditional_setups),
                        f"No T003-conditional in {dec.conditional_setups}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
