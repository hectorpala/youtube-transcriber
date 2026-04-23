"""Load and index reglas_operativas.json (v2.1).

Single source of truth for the motor: the rules JSON file curated in the
knowledge base. The motor consumes the v0.1 subset declared by the JSON itself
(`recommended_v0_1_rule_ids`) — no hardcoded list here.

`MotorConfig.from_rules()` extracts numeric thresholds from
`operational_definitions` so the motor never duplicates values that already
live in the rules layer.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from typing import Any, Optional

DEFAULT_RULES_PATH = os.path.expanduser(
    "~/Documents/trading-knowledge/TradingLatino/reglas_operativas.json"
)


@dataclass
class Rule:
    id: str
    rule_kind: str
    priority: str
    action: str
    action_type: str
    title: str
    rule: str
    evidence_strength: int
    timeframes: list[str]
    conditions: list[str]
    confirmations: list[str]
    invalidations: list[str]
    in_v0_1: bool
    v0_1_dependencies: list[str]
    risk_notes: Optional[str] = None

    @classmethod
    def from_json(cls, d: dict) -> "Rule":
        return cls(
            id=d["id"],
            rule_kind=d["rule_kind"],
            priority=d["priority"],
            action=d["action"],
            action_type=d["action_type"],
            title=d["title"],
            rule=d["rule"],
            evidence_strength=d["evidence_strength"],
            timeframes=d.get("timeframes", []),
            conditions=d.get("conditions", []),
            confirmations=d.get("confirmations", []),
            invalidations=d.get("invalidations", []),
            in_v0_1=d.get("in_v0_1", False),
            v0_1_dependencies=d.get("v0_1_dependencies", []),
            risk_notes=d.get("risk_notes"),
        )


class RuleSet:
    """Indexed access to rules + operational definitions + priority ranks."""

    def __init__(self, data: dict):
        self.raw = data
        self.rules: dict[str, Rule] = {
            r["id"]: Rule.from_json(r) for r in data["rules"]
        }
        self.v0_1_ids: list[str] = list(data.get("recommended_v0_1_rule_ids", []))
        self.operational_definitions: dict = data.get("operational_definitions", {})
        self.motor_defaults: dict = data.get("motor_defaults", {})
        self.priority_rank: dict[str, int] = {
            p: spec.get("rank", 99)
            for p, spec in data.get("priority_vocabulary", {}).items()
        }

    def get(self, rule_id: str) -> Rule:
        return self.rules[rule_id]

    def v0_1_rules(self) -> list[Rule]:
        return [self.rules[rid] for rid in self.v0_1_ids]

    def sorted_v0_1(self) -> list[Rule]:
        """V0.1 rules sorted by priority rank (lowest rank first = evaluated first)."""
        return sorted(self.v0_1_rules(), key=lambda r: self.priority_rank.get(r.priority, 99))

    def by_priority(self, priority: str) -> list[Rule]:
        return [r for r in self.v0_1_rules() if r.priority == priority]

    def op_def(self, name: str) -> dict:
        return self.operational_definitions.get(name, {})


def load_rules(path: str = DEFAULT_RULES_PATH) -> RuleSet:
    with open(path, "r", encoding="utf-8") as f:
        return RuleSet(json.load(f))


# ---------------------------------------------------------------------------
# MotorConfig — thresholds centralizados, leídos de operational_definitions
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class MotorConfig:
    """Thresholds del motor — ÚNICA fuente de verdad: `reglas_operativas.json`.

    Todos los valores vienen de dos bloques del JSON:
      - `operational_definitions.*` — estructura de mercado (swings, rangos)
      - `motor_defaults.*` — thresholds propios del motor centralizados

    No hay regex parsing. No hay defaults silenciosos. Si falta un campo en el
    JSON, `from_rules()` falla explícito (no hay fallback mágico).
    """
    # De operational_definitions
    swing_n: int
    range_min_amplitude_pct: float
    range_min_tests: int
    narrow_range_pct: float

    # De motor_defaults
    fake_breakout_wick_ratio: float
    cooldown_ms_post_stop: int
    s001_lookback_bars: int
    rr_min: float
    tp_leg_multiplier: float
    sl_profile: dict

    # v0.2 Fase A — classify_context en 3 capas
    location_stretched_pct: float    # |precio - MM55| / MM55 >= X% → stretched
    location_near_pct: float          # |precio - MM55| / MM55 < Y% → near_mm55

    # Trazabilidad
    source: dict = field(default_factory=dict)

    @classmethod
    def from_rules(cls, rules: "RuleSet") -> "MotorConfig":
        od = rules.operational_definitions
        md = rules.motor_defaults
        if not md:
            raise ValueError(
                "reglas_operativas.json no contiene bloque 'motor_defaults'. "
                "El motor requiere esa sección como única fuente de verdad para "
                "sus thresholds. Ver README y motor_defaults._comment en el JSON."
            )

        def _get(block: dict, key: str, expected_type=None):
            if key not in block:
                raise KeyError(f"motor_defaults.{key} ausente en reglas_operativas.json")
            v = block[key]
            # Formato: {"value": X, "source": "...", ...}
            if isinstance(v, dict) and "value" in v:
                return v["value"]
            return v

        # narrow_range_pct: parseado del texto de B010 (caso especial)
        narrow = 0.5
        b010 = rules.rules.get("B010")
        if b010:
            m = re.search(r"<\s*([0-9.]+)\s*%", b010.rule)
            if m:
                narrow = float(m.group(1))

        source = {
            "swing_n": "operational_definitions.swing_high.default_N",
            "range_min_amplitude_pct": "operational_definitions.rango_lateral_confirmado.min_amplitude_pct",
            "range_min_tests": "operational_definitions.rango_lateral_confirmado.min_tests_per_extreme",
            "narrow_range_pct": "rule B010 text (<X%)",
            "fake_breakout_wick_ratio": "motor_defaults.fake_breakout_wick_ratio",
            "cooldown_ms_post_stop": "motor_defaults.cooldown_ms_post_stop",
            "s001_lookback_bars": "motor_defaults.s001_lookback_bars",
            "rr_min": "motor_defaults.rr_min (→ rule R004)",
            "tp_leg_multiplier": "motor_defaults.tp_leg_multiplier",
            "sl_profile": "motor_defaults.sl_profile (→ rule R003)",
            "location_stretched_pct": "motor_defaults.location_stretched_pct (v0.2 Fase A)",
            "location_near_pct": "motor_defaults.location_near_pct (v0.2 Fase A)",
        }

        return cls(
            swing_n=od.get("swing_high", {}).get("default_N", 3),
            range_min_amplitude_pct=od.get("rango_lateral_confirmado", {}).get("min_amplitude_pct", 8.0),
            range_min_tests=od.get("rango_lateral_confirmado", {}).get("min_tests_per_extreme", 2),
            narrow_range_pct=narrow,
            fake_breakout_wick_ratio=_get(md, "fake_breakout_wick_ratio"),
            cooldown_ms_post_stop=_get(md, "cooldown_ms_post_stop"),
            s001_lookback_bars=_get(md, "s001_lookback_bars"),
            rr_min=_get(md, "rr_min"),
            tp_leg_multiplier=_get(md, "tp_leg_multiplier"),
            sl_profile=dict(_get(md, "sl_profile")),
            location_stretched_pct=_get(md, "location_stretched_pct"),
            location_near_pct=_get(md, "location_near_pct"),
            source=source,
        )
