"""Tests v0.2 Fase A — clasificador de contexto en 3 capas + family filter.

Cubre los casos concretos que v0.1 no modelaba bien:
  - BTC con precio −17% bajo MM55 semanal pero slope MM55 barely positive
    → macro_bias DEBE ser neutral (no bull como v0.1 lo clasificaba).
  - HBAR/DOT con precio stretched_below + 1W bajista
    → allowed_setup_families DEBE incluir 'accumulation' (v0.1 bloqueaba todo).
  - Rango lateral en 1D y 4H → range_fade habilitado.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
PKG_ROOT = HERE.parent
if str(PKG_ROOT.parent) not in sys.path:
    sys.path.insert(0, str(PKG_ROOT.parent))

from chart_reader_v0_1 import (
    Bar, Indicators, TimeframeData, MarketSnapshot, Evaluator,
)
from chart_reader_v0_1.rules_loader import load_rules, MotorConfig
from chart_reader_v0_1.evaluator import classify_context, compute_family_filter
from chart_reader_v0_1.types import Context


def _tf(tf_name, last_close, mm55, mm55_prev, adx, adx_prev=None):
    """Helper: crea TimeframeData con 1 bar y los indicators clave."""
    bar = Bar(timestamp=0, open=last_close, high=last_close, low=last_close,
              close=last_close, volume=1.0)
    return TimeframeData(
        timeframe=tf_name, bars=[bar],
        indicators=Indicators(mm55=mm55, mm55_prev=mm55_prev,
                              adx=adx, adx_prev=adx_prev or adx),
    )


class TestLocationState(unittest.TestCase):
    """location_state: distancia del precio a MM55."""

    @classmethod
    def setUpClass(cls):
        cls.cfg = MotorConfig.from_rules(load_rules())

    def test_stretched_below_mm55_when_price_17pct_below(self):
        tf = _tf("1W", last_close=79000, mm55=95900, mm55_prev=95890, adx=32)
        ctx = classify_context(tf, self.cfg)
        self.assertEqual(ctx.location_state, "stretched_below_mm55",
                         f"79k vs MM55 95.9k = −17.6% debería ser stretched_below")

    def test_stretched_above_mm55_when_price_20pct_above(self):
        tf = _tf("4H", last_close=120, mm55=100, mm55_prev=99, adx=25)
        ctx = classify_context(tf, self.cfg)
        self.assertEqual(ctx.location_state, "stretched_above_mm55")

    def test_near_mm55_when_within_3pct(self):
        tf = _tf("1D", last_close=100, mm55=101, mm55_prev=100.5, adx=18)
        ctx = classify_context(tf, self.cfg)
        self.assertEqual(ctx.location_state, "near_mm55")

    def test_above_mm55_between_3_and_15_pct(self):
        tf = _tf("4H", last_close=108, mm55=100, mm55_prev=99.5, adx=22)
        ctx = classify_context(tf, self.cfg)
        self.assertEqual(ctx.location_state, "above_mm55")


class TestMacroBias(unittest.TestCase):
    """macro_bias: slope MM55 con umbral de magnitud."""

    @classmethod
    def setUpClass(cls):
        cls.cfg = MotorConfig.from_rules(load_rules())

    def test_slope_almost_flat_is_neutral_not_bull(self):
        """Caso BTC actual: MM55=95918, slope=+10.87 (+0.011%) → NEUTRAL, no bull.
        Esto es el bug principal que v0.2 Fase A corrige.
        """
        tf = _tf("1W", last_close=79000, mm55=95918, mm55_prev=95907, adx=32)
        ctx = classify_context(tf, self.cfg)
        self.assertEqual(ctx.macro_bias, "neutral",
                         f"Slope {(95918-95907)/95918*100:.3f}% es casi plano → neutral")

    def test_clear_bull_slope_is_bull(self):
        tf = _tf("1D", last_close=105, mm55=100, mm55_prev=98, adx=25)
        ctx = classify_context(tf, self.cfg)
        self.assertEqual(ctx.macro_bias, "bull")

    def test_clear_bear_slope_is_bear(self):
        tf = _tf("1D", last_close=95, mm55=100, mm55_prev=102, adx=28)
        ctx = classify_context(tf, self.cfg)
        self.assertEqual(ctx.macro_bias, "bear")

    def test_stretched_below_with_positive_slope_stays_neutral(self):
        """Slope positivo pero precio stretched_below = corrección profunda, no bull."""
        tf = _tf("1W", last_close=70, mm55=100, mm55_prev=99, adx=30)
        ctx = classify_context(tf, self.cfg)
        self.assertEqual(ctx.macro_bias, "neutral",
                         "stretched_below aunque MM55 suba no es bull operable")


class TestExecutionRegime(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cfg = MotorConfig.from_rules(load_rules())

    def test_trend_follow_when_adx_strong_and_bias_bull(self):
        tf = _tf("1D", last_close=105, mm55=100, mm55_prev=98, adx=28)
        ctx = classify_context(tf, self.cfg)
        self.assertEqual(ctx.execution_regime, "trend_follow")

    def test_panic_extension_when_stretched_and_adx_strong(self):
        tf = _tf("1W", last_close=70, mm55=100, mm55_prev=101, adx=35)
        ctx = classify_context(tf, self.cfg)
        # stretched_below + ADX fuerte + mm_slope negativo → panic_extension
        self.assertEqual(ctx.execution_regime, "panic_extension")

    def test_mean_reversion_candidate_when_stretched_and_adx_weak(self):
        tf = _tf("4H", last_close=70, mm55=100, mm55_prev=100.1, adx=18)
        ctx = classify_context(tf, self.cfg)
        self.assertEqual(ctx.execution_regime, "mean_reversion_candidate")

    def test_range_when_adx_weak_and_price_near(self):
        tf = _tf("4H", last_close=100, mm55=101, mm55_prev=100.5, adx=15)
        ctx = classify_context(tf, self.cfg)
        self.assertEqual(ctx.execution_regime, "range")


class TestFamilyFilter(unittest.TestCase):
    """compute_family_filter: C002 ya no bloquea universal; marca familias habilitadas."""

    def _ctx(self, macro_bias, location, regime):
        return Context(macro_bias=macro_bias, location_state=location,
                       execution_regime=regime)

    def test_trend_follow_blocked_when_1w_1d_diverge(self):
        """Caso típico v0.1: C002 bloqueaba global; ahora sólo bloquea trend_follow."""
        ctxs = {
            "1W": self._ctx("bull", "above_mm55", "trend_follow"),
            "1D": self._ctx("bear", "below_mm55", "trend_follow"),
        }
        allowed, _ = compute_family_filter(ctxs)
        self.assertNotIn("trend_follow", allowed,
                         "1W bull + 1D bear → trend_follow NO habilitado")
        self.assertIn("exit_only", allowed)

    def test_trend_follow_enabled_when_1w_1d_aligned(self):
        ctxs = {
            "1W": self._ctx("bull", "above_mm55", "trend_follow"),
            "1D": self._ctx("bull", "above_mm55", "trend_follow"),
        }
        allowed, _ = compute_family_filter(ctxs)
        self.assertIn("trend_follow", allowed)

    def test_accumulation_enabled_when_1w_stretched_below(self):
        """Caso DOT/HBAR real: 1W bear + stretched_below → accumulation habilitada.
        v0.1 bloqueaba todo con C002; v0.2 permite acumulación escalonada.
        """
        ctxs = {
            "1W": self._ctx("bear", "stretched_below_mm55", "panic_extension"),
            "1D": self._ctx("neutral", "near_mm55", "range"),
        }
        allowed, reasons = compute_family_filter(ctxs)
        self.assertIn("accumulation", allowed,
                      "1W stretched_below + bear macro → accumulation debe habilitarse")
        self.assertFalse(any("trend_follow" in a for a in allowed if a != "exit_only") or "trend_follow" in allowed,
                         "trend_follow NO debe habilitarse con 1W bear / 1D neutral")

    def test_range_fade_enabled_when_both_tf_range(self):
        ctxs = {
            "1W": self._ctx("neutral", "near_mm55", "range"),
            "1D": self._ctx("neutral", "near_mm55", "range"),
            "4H": self._ctx("neutral", "near_mm55", "range"),
        }
        allowed, _ = compute_family_filter(ctxs)
        self.assertIn("range_fade", allowed)

    def test_mean_reversion_enabled_when_4h_candidate(self):
        ctxs = {
            "1W": self._ctx("bear", "stretched_below_mm55", "panic_extension"),
            "1D": self._ctx("neutral", "below_mm55", "range"),
            "4H": self._ctx("neutral", "stretched_below_mm55", "mean_reversion_candidate"),
        }
        allowed, _ = compute_family_filter(ctxs)
        self.assertIn("mean_reversion", allowed)

    def test_exit_only_always_allowed(self):
        """exit_only siempre habilitada — no requiere contexto favorable."""
        ctxs = {
            "1W": self._ctx("neutral", "unknown", "indefinido"),
            "1D": self._ctx("neutral", "unknown", "indefinido"),
        }
        allowed, _ = compute_family_filter(ctxs)
        self.assertIn("exit_only", allowed)


class TestEvaluatorIntegration(unittest.TestCase):
    """Caso real BTC post-v0.2 Fase A: no_trade siendo correcto pero ahora con
    context_per_tf visible y allowed_setup_families expuesto."""

    def test_btc_stretched_below_1w_exposes_context(self):
        """BTC actual: 1W precio −17% bajo MM55 + slope casi plano.
        Antes v0.2 → 1W 'tendencial_alcista' (confuso).
        Ahora v0.2 → 1W macro_bias='neutral', location='stretched_below_mm55'.
        """
        tfs = {
            "1W": _tf("1W", 79000, 95918, 95907, 32, 33),
            "1D": _tf("1D", 79025, 70591, 70381, 20, 19),
            "4H": _tf("4H", 79000, 75433, 75286, 20, 18),
        }
        snap = MarketSnapshot(symbol="BTC-USDT", as_of=0, timeframes=tfs, flags={})
        dec = Evaluator().evaluate(snap)
        self.assertEqual(dec.context_per_tf["1W"].macro_bias, "neutral",
                         "BTC 1W debe clasificar como neutral (no bull) con v0.2")
        self.assertEqual(dec.context_per_tf["1W"].location_state, "stretched_below_mm55")
        self.assertIn("exit_only", dec.allowed_setup_families)


if __name__ == "__main__":
    unittest.main(verbosity=2)
