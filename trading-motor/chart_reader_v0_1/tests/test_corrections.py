"""Tests para la iteración correctiva v0.1:

- R004: R:R < 1:2 bloquea entrada
- R002: validación real del stop_loss del risk_plan
- B005: guard visible en reasoning_chain cuando conditions se cumplen
- Config: thresholds leídos desde operational_definitions
"""

from __future__ import annotations

import sys
import unittest
from dataclasses import replace
from pathlib import Path

HERE = Path(__file__).resolve().parent
PKG_ROOT = HERE.parent
if str(PKG_ROOT.parent) not in sys.path:
    sys.path.insert(0, str(PKG_ROOT.parent))

from chart_reader_v0_1 import (
    Bar, Indicators, TimeframeData, MarketSnapshot, Evaluator,
)
from chart_reader_v0_1.rules_loader import MotorConfig, load_rules
from chart_reader_v0_1.types import RiskPlan
from chart_reader_v0_1.tests.test_motor import load_snapshot


# ---------------------------------------------------------------------------
# R004 — R:R mínimo 1:2
# ---------------------------------------------------------------------------
class TestR004(unittest.TestCase):
    def test_rr_below_min_blocks_entry(self):
        """Entry lejos del breakout + TP cercano ⇒ R:R<2 ⇒ no_trade con R004."""
        ev = Evaluator()
        snap, _ = load_snapshot("enter_long_abc.json")
        # Subir artificialmente el stop_loss_pct para forzar R:R < 2
        # (usa un config override con SL más amplio)
        huge_sl_config = replace(ev.config, sl_profile={**ev.config.sl_profile, "btc_4h": 20.0})
        ev2 = Evaluator(rules=ev.rules, config=huge_sl_config)
        dec = ev2.evaluate(snap)
        # Con SL 20% la TP proyección debería seguir cumpliendo R:R ≥ 2 (porque
        # TP = entry + 2×SL_distance). Probamos el camino contrario: forzar un
        # rr_min imposible.
        huge_rr_config = replace(ev.config, rr_min=99.0)
        ev3 = Evaluator(rules=ev.rules, config=huge_rr_config)
        dec = ev3.evaluate(snap)
        self.assertEqual(dec.decision, "no_trade")
        self.assertIn("R004", dec.blocking_rule_ids)
        self.assertTrue(any("[R004]" in r for r in dec.reasoning_chain))

    def test_rr_meets_min_allows_entry(self):
        """Fixture estándar: entry al nivel roto + TP 2×leg ⇒ R:R ≥ 2."""
        ev = Evaluator()
        snap, _ = load_snapshot("enter_long_abc.json")
        dec = ev.evaluate(snap)
        self.assertEqual(dec.decision, "enter_long",
                         f"chain: {dec.reasoning_chain}")
        self.assertIsNotNone(dec.risk_plan)
        self.assertGreaterEqual(dec.risk_plan.rr_ratio, ev.config.rr_min)
        self.assertIn("R004", dec.applicable_rule_ids)


# ---------------------------------------------------------------------------
# R002 — validación real de SL
# ---------------------------------------------------------------------------
class TestR002(unittest.TestCase):
    def _base_snapshot(self):
        snap, _ = load_snapshot("enter_long_abc.json")
        return snap

    def test_rejects_missing_sl(self):
        ev = Evaluator()
        snap = self._base_snapshot()
        plan = RiskPlan(leverage_cap=10, stop_loss_pct=None, stop_loss_price=None)
        ok, msg = ev._validate_R002(snap, plan, side="long")
        self.assertFalse(ok)
        self.assertIn("stop_loss", msg)

    def test_rejects_zero_or_negative_sl_pct(self):
        ev = Evaluator()
        snap = self._base_snapshot()
        plan = RiskPlan(leverage_cap=10, stop_loss_pct=0, stop_loss_price=70000)
        ok, _ = ev._validate_R002(snap, plan, side="long")
        self.assertFalse(ok)

    def test_rejects_sl_above_entry_for_long(self):
        ev = Evaluator()
        snap = self._base_snapshot()
        entry = snap.timeframes["4H"].bars[-1].close
        plan = RiskPlan(leverage_cap=10, stop_loss_pct=2.0, stop_loss_price=entry + 100)
        ok, msg = ev._validate_R002(snap, plan, side="long")
        self.assertFalse(ok)
        self.assertIn("SL", msg)

    def test_accepts_valid_sl_for_long(self):
        ev = Evaluator()
        snap = self._base_snapshot()
        entry = snap.timeframes["4H"].bars[-1].close
        plan = RiskPlan(leverage_cap=10, stop_loss_pct=2.0, stop_loss_price=entry * 0.98)
        ok, _ = ev._validate_R002(snap, plan, side="long")
        self.assertTrue(ok)

    def test_rejects_absurdly_wide_sl(self):
        ev = Evaluator()
        snap = self._base_snapshot()
        plan = RiskPlan(leverage_cap=10, stop_loss_pct=30.0, stop_loss_price=50000)
        ok, msg = ev._validate_R002(snap, plan, side="long")
        self.assertFalse(ok)
        self.assertIn("excesivo", msg)


# ---------------------------------------------------------------------------
# B005 — precautionary guard
# ---------------------------------------------------------------------------
class TestB005(unittest.TestCase):
    def test_guard_visible_when_btc_1w_alcista(self):
        ev = Evaluator()
        snap, _ = load_snapshot("enter_long_abc.json")
        dec = ev.evaluate(snap)
        self.assertIn("B005", dec.applicable_rule_ids,
                      f"B005 should be visible in applicable rules; chain: {dec.reasoning_chain}")
        self.assertTrue(any("[B005]" in r for r in dec.reasoning_chain))

    def test_guard_silent_when_1w_not_alcista(self):
        ev = Evaluator()
        snap, _ = load_snapshot("enter_long_abc.json")
        # Override 1W MM55 so regime turns lateral
        snap.timeframes["1W"].indicators = Indicators(mm55=64500, mm55_prev=65000, adx=15, adx_prev=16)
        dec = ev.evaluate(snap)
        self.assertNotIn("B005", dec.applicable_rule_ids,
                         f"B005 should NOT activate when 1W is not alcista; chain: {dec.reasoning_chain}")

    def test_public_short_intent_hook(self):
        """short_intent_blocked_by_B005 debe retornar True cuando BTC 1W alcista."""
        ev = Evaluator()
        snap, _ = load_snapshot("enter_long_abc.json")
        self.assertTrue(ev.short_intent_blocked_by_B005(snap))
        # Symbol no-BTC → no bloquea
        snap2 = MarketSnapshot(symbol="ETH-USDT", as_of=snap.as_of,
                               timeframes=snap.timeframes, flags=snap.flags)
        self.assertFalse(ev.short_intent_blocked_by_B005(snap2))


# ---------------------------------------------------------------------------
# Config from operational_definitions
# ---------------------------------------------------------------------------
class TestConfig(unittest.TestCase):
    def test_config_pulls_from_rules_layer(self):
        rules = load_rules()
        cfg = MotorConfig.from_rules(rules)
        od = rules.operational_definitions
        md = rules.motor_defaults
        # De operational_definitions
        self.assertEqual(cfg.swing_n, od["swing_high"]["default_N"])
        self.assertEqual(cfg.range_min_amplitude_pct,
                         od["rango_lateral_confirmado"]["min_amplitude_pct"])
        self.assertEqual(cfg.range_min_tests,
                         od["rango_lateral_confirmado"]["min_tests_per_extreme"])
        self.assertAlmostEqual(cfg.narrow_range_pct, 0.5, places=2)
        # De motor_defaults — single source of truth
        self.assertAlmostEqual(cfg.fake_breakout_wick_ratio,
                               md["fake_breakout_wick_ratio"]["value"], places=4)
        self.assertEqual(cfg.cooldown_ms_post_stop,
                         md["cooldown_ms_post_stop"]["value"])
        self.assertEqual(cfg.s001_lookback_bars,
                         md["s001_lookback_bars"]["value"])
        self.assertEqual(cfg.rr_min, md["rr_min"]["value"])
        self.assertEqual(cfg.tp_leg_multiplier, md["tp_leg_multiplier"]["value"])
        self.assertEqual(cfg.sl_profile, md["sl_profile"]["value"])

    def test_config_fails_without_motor_defaults(self):
        """Si falta el bloque motor_defaults, from_rules() debe fallar explícito."""
        rules = load_rules()
        # Stub a rules-set con motor_defaults vacío
        class StubRules:
            def __init__(self, r):
                self.rules = r.rules
                self.operational_definitions = r.operational_definitions
                self.motor_defaults = {}
        with self.assertRaises(ValueError) as ctx:
            MotorConfig.from_rules(StubRules(rules))
        self.assertIn("motor_defaults", str(ctx.exception))

    def test_config_source_map_documents_origin(self):
        cfg = MotorConfig.from_rules(load_rules())
        for key in ["swing_n", "range_min_amplitude_pct",
                    "fake_breakout_wick_ratio", "cooldown_ms_post_stop",
                    "s001_lookback_bars", "rr_min", "tp_leg_multiplier",
                    "sl_profile"]:
            self.assertIn(key, cfg.source, f"Missing source entry for {key}")

    def test_r004_in_v0_1_subset(self):
        rules = load_rules()
        self.assertIn("R004", rules.v0_1_ids,
                      "R004 should be in recommended_v0_1_rule_ids after the correction")


# ---------------------------------------------------------------------------
# Coherencia JSON ↔ runtime
# ---------------------------------------------------------------------------
class TestCoherence(unittest.TestCase):
    """Asegura que no hay dos fuentes de verdad coexistiendo para thresholds."""

    def test_runtime_mecha_matches_motor_defaults_exactly(self):
        """El wick ratio que usa el runtime (MotorConfig) debe ser EL MISMO que
        está en reglas_operativas.json → motor_defaults.fake_breakout_wick_ratio."""
        import json
        with open(
            "/Users/openclaw/Documents/trading-knowledge/TradingLatino/reglas_operativas.json",
            "r", encoding="utf-8"
        ) as f:
            raw = json.load(f)
        json_value = raw["motor_defaults"]["fake_breakout_wick_ratio"]["value"]
        rules = load_rules()
        cfg = MotorConfig.from_rules(rules)
        self.assertEqual(cfg.fake_breakout_wick_ratio, json_value,
                         f"runtime ({cfg.fake_breakout_wick_ratio}) != JSON ({json_value})")

    def test_cooldown_not_hardcoded_in_evaluator_path(self):
        """El cooldown debe venir de config, no de un número mágico en el código.
        Verificación indirecta: si mutamos config.cooldown, el runtime lo respeta."""
        from dataclasses import replace
        ev = Evaluator()
        # Con cooldown de 0ms, un stop reciente no debería bloquear
        cfg_no_cooldown = replace(ev.config, cooldown_ms_post_stop=0)
        ev_no_cd = Evaluator(rules=ev.rules, config=cfg_no_cooldown)
        snap, _ = load_snapshot("no_trade_cooldown.json")
        dec = ev_no_cd.evaluate(snap)
        self.assertNotIn("I003", dec.blocking_rule_ids,
                         "con cooldown=0 NO debería bloquear por I003")

        # Con cooldown gigante, siempre bloquea
        cfg_big_cooldown = replace(ev.config, cooldown_ms_post_stop=10 ** 12)
        ev_big = Evaluator(rules=ev.rules, config=cfg_big_cooldown)
        dec2 = ev_big.evaluate(snap)
        self.assertIn("I003", dec2.blocking_rule_ids)

    def test_s001_lookback_not_hardcoded(self):
        """Si mutamos config.s001_lookback_bars a 1, el setup NO debería detectarse
        porque la ventana es insuficiente para capturar la onda C."""
        from dataclasses import replace
        ev = Evaluator()
        cfg_tiny = replace(ev.config, s001_lookback_bars=1)
        ev_tiny = Evaluator(rules=ev.rules, config=cfg_tiny)
        snap, _ = load_snapshot("enter_long_abc.json")
        dec = ev_tiny.evaluate(snap)
        # Con lookback=1 NO debe encontrar onda C tocando MM55+POC
        # (el último bar cierra en 75000, muy por encima)
        self.assertNotIn("S001", dec.applicable_rule_ids,
                         f"S001 no debería activar con lookback=1; chain: {dec.reasoning_chain}")

    def test_tp_multiplier_from_config(self):
        """TP debe respetar tp_leg_multiplier del config."""
        from dataclasses import replace
        ev = Evaluator()
        snap, _ = load_snapshot("enter_long_abc.json")
        dec_normal = ev.evaluate(snap)
        tp_normal = dec_normal.risk_plan.take_profit_price

        cfg_bigger = replace(ev.config, tp_leg_multiplier=4.0)
        ev_bigger = Evaluator(rules=ev.rules, config=cfg_bigger)
        dec_bigger = ev_bigger.evaluate(snap)
        tp_bigger = dec_bigger.risk_plan.take_profit_price
        self.assertGreater(tp_bigger, tp_normal,
                           "TP con multiplier 4 debe ser mayor que con 2")


if __name__ == "__main__":
    unittest.main(verbosity=2)
