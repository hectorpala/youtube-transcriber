"""Chart Reader v0.1 — motor de decisión basado en `reglas_operativas.json` v2.1.

Uso:
    from chart_reader_v0_1 import Evaluator, MarketSnapshot, load_rules

    evaluator = Evaluator()                       # carga reglas desde default
    decision = evaluator.evaluate(snapshot)       # MarketSnapshot → Decision
"""

from .types import (
    Bar,
    Indicators,
    TimeframeData,
    MarketSnapshot,
    Decision,
    ConditionalSetup,
    RiskPlan,
)
from .rules_loader import RuleSet, Rule, load_rules
from .evaluator import Evaluator

__all__ = [
    "Bar",
    "Indicators",
    "TimeframeData",
    "MarketSnapshot",
    "Decision",
    "ConditionalSetup",
    "RiskPlan",
    "RuleSet",
    "Rule",
    "load_rules",
    "Evaluator",
]
__version__ = "0.1.0"
