"""Chart reader v0.1 — regla a regla evaluator.

Consume MarketSnapshot, emits Decision. Uses ONLY the 13 rules declared by
`reglas_operativas.json` → `recommended_v0_1_rule_ids`:

  C001 · C002 · C003   primary_context
  B005                 blocker (direction-gate)
  I003                 hard_blocker (post-stop cooldown)
  R002                 hard_blocker (require_stop)
  S001                 primary_setup (pauta plana ABC)
  T003                 trigger (ruptura tras cierre + volumen)
  I002 · I007          exit_rule (invalidations for open position / entered breakout)
  R001 · R003          risk_rule (leverage cap, SL sizing)
  E001                 exit_rule (trailing manual escalonado)

Everything else (pools, scalping, psychology advisories) is ignored in v0.1.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from .types import (
    MarketSnapshot,
    Decision,
    ConditionalSetup,
    RiskPlan,
    TimeframeData,
    Context,
    SETUP_FAMILIES,
)
from .rules_loader import RuleSet, MotorConfig, load_rules
from .swings import detect_swings, classify_structure, last_significant_swing
from .structure import (
    detect_range,
    detect_bos,
    detect_tejoden,
    detect_fake_breakout,
    RangeBounds,
)


# ---------------------------------------------------------------------------
# Leverage sizing (R001) — BTC/oro 10x, altcoins 3-5x, shorts 3x
# ---------------------------------------------------------------------------
LEVERAGE_CAP = {
    "BTC": 10, "ETH": 10, "XAU": 10,
    "_default_altcoin_perpetual": 5,
    "_short_futures": 3,
}


def leverage_for(symbol: str, short: bool) -> int:
    if short:
        return LEVERAGE_CAP["_short_futures"]
    base = symbol.upper().split("/")[0].split("-")[0]
    return LEVERAGE_CAP.get(base, LEVERAGE_CAP["_default_altcoin_perpetual"])


# ---------------------------------------------------------------------------
# Context classification v0.2 Fase A — 3 capas
# ---------------------------------------------------------------------------
def classify_context(tf: TimeframeData, config: MotorConfig,
                     last_close_fallback: Optional[float] = None) -> Context:
    """Clasifica contexto en 3 capas (macro_bias, location_state, execution_regime).

    A diferencia del v0.1 binario, separa:
      - macro_bias: qué sesgo tiene la estructura (pendiente MM55 + posición).
      - location_state: dónde está el precio respecto a MM55 (umbral configurable).
      - execution_regime: qué familia de setup operar (no igual al bias).

    `last_close_fallback`: si `tf.bars` está vacío (TFs superiores que sólo
    traen indicators), usa este precio como proxy para calcular location_state.
    Típicamente se pasa el close del 4H.
    """
    ind = tf.indicators
    if tf.bars:
        last_close = tf.bars[-1].close
    elif last_close_fallback is not None:
        last_close = last_close_fallback
    else:
        return Context("neutral", "unknown", "indefinido")
    adx = ind.adx
    mm55 = ind.mm55
    mm_slope = None
    if mm55 is not None and ind.mm55_prev is not None:
        mm_slope = mm55 - ind.mm55_prev

    # --- location_state: distancia relativa a MM55 ---
    location_state = "unknown"
    if mm55 and mm55 > 0:
        diff_pct = (last_close - mm55) / mm55 * 100
        if diff_pct >= config.location_stretched_pct:
            location_state = "stretched_above_mm55"
        elif diff_pct >= config.location_near_pct:
            location_state = "above_mm55"
        elif diff_pct > -config.location_near_pct:
            location_state = "near_mm55"
        elif diff_pct > -config.location_stretched_pct:
            location_state = "below_mm55"
        else:
            location_state = "stretched_below_mm55"

    # --- macro_bias: pendiente MM55 con umbral de magnitud ---
    # Un slope numéricamente positivo pero casi plano (ej: +0.01%) NO es bull.
    # Umbral: 0.3% del valor del MM55 por bar. Además, si precio stretched_below
    # mientras MM55 sube apenas, es corrección profunda, no bull operable.
    SLOPE_SIGNIFICANT_PCT = 0.3
    macro_bias = "neutral"
    if mm_slope is not None and mm55 and mm55 > 0:
        slope_pct = abs(mm_slope / mm55 * 100)
        if slope_pct < SLOPE_SIGNIFICANT_PCT:
            macro_bias = "neutral"   # slope demasiado plano — no hay bias claro
        elif mm_slope > 0 and location_state == "stretched_below_mm55":
            # slope alcista pero precio muy por debajo = corrección profunda
            macro_bias = "neutral"
        elif mm_slope > 0:
            macro_bias = "bull"
        elif mm_slope < 0 and location_state == "stretched_above_mm55":
            # slope bajista pero precio muy por encima = rally contra-estructura
            macro_bias = "neutral"
        elif mm_slope < 0:
            macro_bias = "bear"

    # --- execution_regime: qué tipo de setup aplica ---
    # Orden de evaluación importante: stretched tiene prioridad sobre ADX-puro,
    # para detectar 'tendencia acelerada en riesgo' vs 'trend_follow sano'.
    execution_regime = "indefinido"
    stretched = location_state in ("stretched_below_mm55", "stretched_above_mm55")
    if adx is not None and mm_slope is not None:
        if stretched and adx >= 23:
            execution_regime = "panic_extension"
        elif stretched and adx < 23:
            execution_regime = "mean_reversion_candidate"
        elif adx >= 23 and macro_bias in ("bull", "bear"):
            execution_regime = "trend_follow"
        elif adx < 23 and location_state in ("near_mm55", "above_mm55", "below_mm55"):
            execution_regime = "range"
    return Context(macro_bias=macro_bias, location_state=location_state,
                   execution_regime=execution_regime)


def classify_regime_tf(tf: TimeframeData) -> str:
    """v0.1 back-compat: etiqueta simple de régimen para `regime_per_tf`.

    Deriva de classify_context pero preservando la taxonomía antigua
    (`tendencial_alcista | tendencial_bajista | lateral | indefinido`)
    para que los tests existentes sigan pasando.
    """
    ind = tf.indicators
    adx = ind.adx
    mm_slope = None
    if ind.mm55 is not None and ind.mm55_prev is not None:
        mm_slope = ind.mm55 - ind.mm55_prev
    if adx is None or mm_slope is None:
        return "indefinido"
    if adx >= 23 and mm_slope > 0:
        return "tendencial_alcista"
    if adx >= 23 and mm_slope < 0:
        return "tendencial_bajista"
    return "lateral"


def compute_family_filter(context_per_tf: dict[str, Context]) -> tuple[list[str], list[str]]:
    """Dado el contexto por TF, devuelve qué familias de setup están habilitadas
    y la razón de habilitación/bloqueo para reasoning_chain.

    Familias:
      - trend_follow: requiere macro_bias de 1W == 1D y coherente con 4H.
      - accumulation: macro_bias de 1W bear/neutral + location_state 1W o 1D
        stretched_below_mm55 (corrección profunda = zona de acumulación).
      - mean_reversion: execution_regime == mean_reversion_candidate en 1D o 4H.
      - range_fade: execution_regime == range en 1D y 4H.
      - exit_only: siempre disponible (no requiere contexto).
    """
    c_1w = context_per_tf.get("1W")
    c_1d = context_per_tf.get("1D")
    c_4h = context_per_tf.get("4H")
    allowed = ["exit_only"]
    reasons = []

    # --- trend_follow: alineación macro_bias 1W + 1D ---
    if c_1w and c_1d:
        if c_1w.macro_bias in ("bull", "bear") and c_1w.macro_bias == c_1d.macro_bias:
            allowed.append("trend_follow")
            reasons.append(
                f"trend_follow habilitado: 1W y 1D coinciden en macro_bias={c_1w.macro_bias}"
            )
        else:
            reasons.append(
                f"trend_follow bloqueado: 1W.macro_bias={c_1w.macro_bias}, "
                f"1D.macro_bias={c_1d.macro_bias} (no coinciden o neutrales)"
            )

    # --- accumulation: bear mayor + stretched_below ---
    if c_1w and c_1d:
        bear_or_neutral_macro = (c_1w.macro_bias in ("bear", "neutral")
                                 or c_1d.macro_bias in ("bear", "neutral"))
        stretched_below_somewhere = any(
            c and c.location_state == "stretched_below_mm55"
            for c in (c_1w, c_1d)
        )
        if bear_or_neutral_macro and stretched_below_somewhere:
            allowed.append("accumulation")
            which_tf = "1W" if c_1w.location_state == "stretched_below_mm55" else "1D"
            reasons.append(
                f"accumulation habilitada: {which_tf}.location_state=stretched_below_mm55 "
                f"(precio lejos bajo MM55 → zona de acumulación escalonada)"
            )

    # --- mean_reversion: execution_regime en 1D o 4H ---
    if any(c and c.execution_regime == "mean_reversion_candidate"
           for c in (c_1d, c_4h)):
        allowed.append("mean_reversion")
        reasons.append(
            "mean_reversion habilitada: execution_regime=mean_reversion_candidate "
            "en 1D o 4H (stretched + ADX débil = posible agotamiento)"
        )

    # --- range_fade: 1D y 4H ambos en régimen range ---
    if c_1d and c_4h and c_1d.execution_regime == "range" and c_4h.execution_regime == "range":
        allowed.append("range_fade")
        reasons.append(
            "range_fade habilitado: 1D y 4H ambos en execution_regime=range"
        )

    return allowed, reasons


# ---------------------------------------------------------------------------
# Main evaluator
# ---------------------------------------------------------------------------
class Evaluator:
    def __init__(self, rules: Optional[RuleSet] = None,
                 config: Optional[MotorConfig] = None):
        self.rules = rules or load_rules()
        self.config = config or MotorConfig.from_rules(self.rules)

    # ------------- entry point -------------
    def evaluate(self, snapshot: MarketSnapshot) -> Decision:
        decision = Decision(symbol=snapshot.symbol, as_of=snapshot.as_of, regime="indefinido")

        # 0. v0.2 Fase A — contexto en 3 capas por TF
        # Determinar fallback de last_close desde el TF más fino con bars
        last_close_fallback = None
        for tf_name in ("4H", "1H", "1D", "1W"):
            tf_obj = snapshot.timeframes.get(tf_name)
            if tf_obj and tf_obj.bars:
                last_close_fallback = tf_obj.bars[-1].close
                break
        for tf_name, tf in snapshot.timeframes.items():
            decision.regime_per_tf[tf_name] = classify_regime_tf(tf)       # back-compat v0.1
            decision.context_per_tf[tf_name] = classify_context(
                tf, self.config, last_close_fallback=last_close_fallback)
        primary_tf = "1D" if "1D" in snapshot.timeframes else next(iter(snapshot.timeframes), "1D")
        decision.regime = decision.regime_per_tf.get(primary_tf, "indefinido")
        decision.applicable_rule_ids.append("C001")

        # Reasoning: mostrar contexto completo, no sólo régimen
        ctx_summary = {
            tf: f"{c.macro_bias}/{c.location_state}/{c.execution_regime}"
            for tf, c in decision.context_per_tf.items()
        }
        decision.reasoning_chain.append(
            f"[C001] context per TF (macro_bias/location/regime): {ctx_summary}"
        )

        # 1. Hard blockers — short-circuit any decision
        if self._apply_I003(snapshot, decision):
            return self._finalize(decision, "no_trade")

        # 2. v0.2 Fase A — C002 compute family filter (no blocker universal)
        allowed_families, family_reasons = compute_family_filter(decision.context_per_tf)
        decision.allowed_setup_families = allowed_families
        decision.applicable_rule_ids.append("C002")
        for r in family_reasons:
            decision.reasoning_chain.append(f"[C002] {r}")
        decision.reasoning_chain.append(
            f"[C002] allowed_setup_families={allowed_families}"
        )
        # back-compat: aligned=True si trend_follow está habilitado
        aligned = "trend_follow" in allowed_families

        tejoden_fb = self._detect_tejoden(snapshot)
        if tejoden_fb and tejoden_fb.detected:
            decision.reasoning_chain.append(
                f"[C003] tejoden detectado en {tejoden_fb.side} del rango, level={tejoden_fb.level}"
            )
            decision.blocking_rule_ids.append("C003")
            # suggest conditional setup after ~48h or after confirmed break
            self._conditional_post_tejoden(snapshot, decision, tejoden_fb)
            return self._finalize(decision, "wait")

        # 3. Invalidations with existing position (I002 / I007)
        if snapshot.flags.get("position_open"):
            if self._apply_I002(snapshot, decision):
                return self._finalize(decision, "exit_position")
            if self._apply_I007(snapshot, decision):
                return self._finalize(decision, "exit_position")

        # 4. Directional guard B005 (precautionary — BTC 1W alcista)
        # v0.1 no tiene setups short, así que B005 queda WIRED pero DORMANT.
        # Se expone en reasoning_chain cuando sus condiciones se cumplen para
        # señalizar que cualquier intento de enter_short sería bloqueado.
        self._precautionary_B005(snapshot, decision)

        # 5. Setup S001 (pauta plana ABC long 4H)
        has_setup, setup_info = self._check_S001(snapshot, decision)
        if not aligned or not has_setup:
            # no primary setup ready → propose conditional
            self._conditional_no_setup(snapshot, decision, aligned=aligned, setup_info=setup_info)
            return self._finalize(decision, "wait" if not decision.blocking_rule_ids else "no_trade")

        decision.applicable_rule_ids.append("S001")
        decision.reasoning_chain.append(f"[S001] {setup_info['why']}")

        # 6. Trigger T003 (ruptura tras cierre + volumen)
        triggered, trigger_info = self._check_T003(snapshot, setup_info)
        if not triggered:
            # Setup present but trigger pending → conditional
            self._conditional_pending_trigger(snapshot, decision, setup_info, trigger_info)
            return self._finalize(decision, "wait")

        decision.applicable_rule_ids.append("T003")
        decision.reasoning_chain.append(f"[T003] {trigger_info['why']}")

        # 7. Build tentative risk plan + preconditions
        decision.risk_plan = self._build_risk_plan(snapshot, setup_info, trigger_info)
        decision.applicable_rule_ids.extend(["R001", "R003", "E001"])
        decision.reasoning_chain.append(
            f"[R001/R003] leverage_cap={decision.risk_plan.leverage_cap}, "
            f"SL={decision.risk_plan.stop_loss_pct}%"
        )

        # R002 real: validar que el risk_plan tenga SL utilizable
        r002_ok, r002_msg = self._validate_R002(snapshot, decision.risk_plan, side="long")
        if not r002_ok:
            decision.blocking_rule_ids.append("R002")
            decision.reasoning_chain.append(f"[R002] {r002_msg}")
            return self._finalize(decision, "no_trade")
        decision.applicable_rule_ids.append("R002")

        # R004: R:R mínimo 1:2 — política explícita de v0.1: no entrar si no se cumple
        rr = decision.risk_plan.rr_ratio
        if rr is None or rr < self.config.rr_min:
            decision.blocking_rule_ids.append("R004")
            decision.reasoning_chain.append(
                f"[R004] R:R={rr if rr is not None else 'NA'} < {self.config.rr_min} — "
                f"trade rentable estructuralmente requiere R:R mínimo 1:2; no_trade"
            )
            return self._finalize(decision, "no_trade")
        decision.applicable_rule_ids.append("R004")
        decision.reasoning_chain.append(
            f"[E001] exit plan: +3%→BE, +7%→+5%, luego trailing 4-4.5%"
        )

        return self._finalize(decision, "enter_long", confidence=0.7)

    # ------------- hard blockers -------------
    def _apply_I003(self, snap: MarketSnapshot, dec: Decision) -> bool:
        """Post-stop cooldown — ventana desde MotorConfig.cooldown_ms_post_stop."""
        last = snap.flags.get("last_stop_timestamp")
        if not last:
            return False
        if snap.as_of - last < self.config.cooldown_ms_post_stop:
            hours = self.config.cooldown_ms_post_stop // (60 * 60 * 1000)
            dec.blocking_rule_ids.append("I003")
            dec.reasoning_chain.append(
                f"[I003] stop ejecutado hace <{hours}h — cooldown activo, no reentrar"
            )
            return True
        return False

    # ------------- B005 precautionary guard (dormant in v0.1) -------------
    def _precautionary_B005(self, snap: MarketSnapshot, dec: Decision) -> None:
        """B005 bloquearía cualquier enter_short cuando BTC 1W es alcista.
        v0.1 no tiene setups short; el guard queda visible para auditabilidad
        pero no bloquea nada activo. Cuando v0.2 incluya S007, este mismo
        método será el hook de bloqueo real via `short_intent_blocked_by_B005`.
        """
        base = snap.symbol.upper().split("/")[0].split("-")[0]
        if base != "BTC":
            return
        if dec.regime_per_tf.get("1W") != "tendencial_alcista":
            return
        dec.applicable_rule_ids.append("B005")
        dec.reasoning_chain.append(
            "[B005] precautionary guard activo: BTC 1W alcista → cualquier "
            "enter_short quedaría bloqueado (dormant: v0.1 no propone shorts)"
        )

    def short_intent_blocked_by_B005(self, snap: MarketSnapshot) -> bool:
        """Hook público para futuros setups short (v0.2). Retorna True si
        B005 bloquearía un enter_short ahora mismo.
        """
        base = snap.symbol.upper().split("/")[0].split("-")[0]
        if base != "BTC":
            return False
        tf = snap.timeframes.get("1W")
        if not tf:
            return False
        return classify_regime_tf(tf) == "tendencial_alcista"

    # ------------- alignment (C002) -------------
    def _check_alignment(self, regime_per_tf: dict[str, str]) -> tuple[bool, str]:
        w = regime_per_tf.get("1W")
        d = regime_per_tf.get("1D")
        if not w or not d:
            return False, "no hay datos suficientes de 1W/1D"
        if w == d and "tendencial" in w:
            return True, f"1W={w} y 1D={d} alineados"
        if w == "lateral" or d == "lateral":
            return False, f"1W={w}, 1D={d} → sin tendencia alineada; sólo setups de rango"
        return False, f"1W={w} vs 1D={d} divergen — no operar direccional"

    # ------------- tejoden (C003) -------------
    def _detect_tejoden(self, snap: MarketSnapshot):
        tf = snap.timeframes.get("4H") or snap.timeframes.get("1D")
        if not tf or not tf.bars:
            return None
        swings = detect_swings(tf.bars, n=self.config.swing_n, atr=tf.indicators.atr, atr_filter_mult=1.0)
        bounds = detect_range(tf.bars, swings)
        if not bounds:
            return None
        return detect_tejoden(tf.bars, bounds, tf.indicators.adx, lookback=3,
                              mecha_threshold=self.config.fake_breakout_wick_ratio)

    # ------------- I002 (lose support with volume) -------------
    def _apply_I002(self, snap: MarketSnapshot, dec: Decision) -> bool:
        """BOS bearish on 4H/1D when position long is open."""
        side = snap.flags.get("position_side", "long")
        tf = snap.timeframes.get("4H") or snap.timeframes.get("1D")
        if not tf or not tf.bars:
            return False
        swings = detect_swings(tf.bars, n=self.config.swing_n, atr=tf.indicators.atr, atr_filter_mult=1.0)
        bos = detect_bos(tf.bars, swings, volume_sma20=tf.indicators.volume_sma20)
        if side == "long" and bos.bearish and bos.volume_confirmed:
            dec.blocking_rule_ids.append("I002")
            dec.applicable_rule_ids.append("I002")
            dec.reasoning_chain.append(
                f"[I002] BOS bajista en 4H: cierre {bos.close_price} < swing_low {bos.broken_swing_price} con volumen"
            )
            return True
        return False

    # ------------- I007 (fake breakout) -------------
    def _apply_I007(self, snap: MarketSnapshot, dec: Decision) -> bool:
        """If we entered via breakout and it turned fake, exit."""
        tf = snap.timeframes.get("4H")
        if not tf or not tf.bars:
            return False
        swings = detect_swings(tf.bars, n=self.config.swing_n, atr=tf.indicators.atr, atr_filter_mult=1.0)
        bounds = detect_range(tf.bars, swings)
        if not bounds:
            return False
        fb = detect_fake_breakout(tf.bars, bounds, lookback=3,
                                  mecha_threshold=self.config.fake_breakout_wick_ratio)
        if fb.detected:
            dec.blocking_rule_ids.append("I007")
            dec.applicable_rule_ids.append("I007")
            dec.reasoning_chain.append(
                f"[I007] fake breakout {fb.side} en level {fb.level}; {fb.notes}"
            )
            return True
        return False

    # ------------- S001 (pauta plana ABC long 4H) -------------
    def _check_S001(self, snap: MarketSnapshot, dec: Decision) -> tuple[bool, dict]:
        """S001 es válida si la estructura ABC está completa O en curso:
          (a) en los últimos `config.s001_lookback_bars` la onda C tocó
              confluencia MM55+POC, Y
          (b) el estado actual está en proceso de ruptura o cercano a MM55+POC.
        """
        tf = snap.timeframes.get("4H")
        info: dict = {"why": "", "mm55": None, "poc": None, "last_close": None}
        if not tf or not tf.bars:
            return False, {"why": "sin datos 4H"}
        ind = tf.indicators
        last = tf.bars[-1]
        info.update({"mm55": ind.mm55, "poc": ind.poc, "last_close": last.close})
        if dec.regime_per_tf.get("1W") != "tendencial_alcista":
            return False, {"why": "1W no es tendencial_alcista"}
        if ind.mm55 is None or ind.poc is None:
            return False, {"why": "faltan MM55 o POC en 4H"}
        confluence = (ind.mm55 + ind.poc) / 2
        info["confluence"] = confluence
        # Condition (a): la onda C tocó la confluencia dentro de la ventana reciente
        lookback = self.config.s001_lookback_bars
        window = tf.bars[-lookback:]
        touched = any(b.low <= confluence * 1.01 for b in window)
        if not touched:
            return False, {"why": f"no hay toque reciente (últimos {lookback} bars) a MM55+POC ({confluence:.0f})"}
        # Condition (b): ya no estamos debajo de la confluencia — onda C resuelta al alza
        if last.close < confluence * 0.99:
            return False, {"why": f"precio {last.close:.0f} aún por debajo de confluencia {confluence:.0f}; onda C no resuelta"}
        # ADX sin pendiente bajista fuerte
        if ind.adx is not None and ind.adx_prev is not None:
            adx_slope = ind.adx - ind.adx_prev
            if adx_slope < -2.0 and ind.adx > 25:
                return False, {"why": f"ADX 4H cayendo con fuerza ({ind.adx_prev:.0f}→{ind.adx:.0f})"}
        info["why"] = (
            f"onda C tocó MM55+POC ({confluence:.0f}) dentro de últimos 8 bars; "
            f"último close {last.close:.0f} resolviendo al alza, ADX estable"
        )
        return True, info

    # ------------- T003 (ruptura tras cierre + volumen) -------------
    def _check_T003(self, snap: MarketSnapshot, setup_info: dict) -> tuple[bool, dict]:
        tf = snap.timeframes.get("4H")
        if not tf or not tf.bars:
            return False, {"why": "sin datos 4H", "level": None}
        swings = detect_swings(tf.bars, n=self.config.swing_n, atr=tf.indicators.atr, atr_filter_mult=1.0)
        last_high = last_significant_swing(swings, "high")
        last = tf.bars[-1]
        vol_sma = tf.indicators.volume_sma20
        if last_high is None:
            return False, {"why": "no hay swing_high reciente para romper", "level": None}
        level = last_high.price
        if last.close <= level:
            return False, {
                "why": f"último cierre {last.close:.0f} aún no rompe swing_high {level:.0f}",
                "level": level,
            }
        if vol_sma is not None and last.volume < vol_sma:
            return False, {
                "why": f"cierre rompió {level:.0f} pero volumen {last.volume:.0f} < SMA20 ({vol_sma:.0f})",
                "level": level,
            }
        return True, {
            "why": f"cierre {last.close:.0f} > swing_high {level:.0f} con volumen {last.volume:.0f}",
            "level": level,
        }

    # ------------- R002 validación real -------------
    def _validate_R002(self, snap: MarketSnapshot, plan: Optional[RiskPlan],
                       side: str = "long") -> tuple[bool, str]:
        """Valida que exista un SL utilizable en el risk_plan.
        - plan no nulo, con stop_loss_price y stop_loss_pct > 0
        - stop_loss_pct en rango razonable (<=25% para evitar stops absurdos)
        - side='long': SL < entry; side='short': SL > entry
        """
        if plan is None:
            return False, "risk_plan ausente"
        if plan.stop_loss_price is None or plan.stop_loss_pct is None:
            return False, "risk_plan sin stop_loss_price o stop_loss_pct"
        if plan.stop_loss_pct <= 0:
            return False, f"stop_loss_pct inválido ({plan.stop_loss_pct})"
        if plan.stop_loss_pct > 25.0:
            return False, f"stop_loss_pct excesivo ({plan.stop_loss_pct}% > 25%) — activo demasiado volátil para v0.1"
        tf = snap.timeframes.get("4H") or next(iter(snap.timeframes.values()), None)
        if tf is None or not tf.bars:
            return False, "sin bars para validar dirección del SL"
        entry = tf.bars[-1].close
        if side == "long" and plan.stop_loss_price >= entry:
            return False, f"SL ({plan.stop_loss_price}) >= entry ({entry}) en long — inválido"
        if side == "short" and plan.stop_loss_price <= entry:
            return False, f"SL ({plan.stop_loss_price}) <= entry ({entry}) en short — inválido"
        return True, f"SL válido: {plan.stop_loss_price} ({plan.stop_loss_pct}%)"

    # ------------- Risk plan builder -------------
    def _build_risk_plan(self, snap: MarketSnapshot, setup_info: dict,
                         trigger_info: Optional[dict] = None) -> RiskPlan:
        """Entry canónico T003: 'orden ligeramente por encima del nivel roto'.
        SL tactical per R003: 1.5-2% del entry (no estructural al confluence —
        la frase 'debajo de MM55+POC' de R003 describe DÓNDE cae ese 2% cuando
        se entra al retest; aquí entramos al nivel roto).
        TP: proyección de la pierna (broken_high − onda_C_low) proyectada sobre
        el nivel roto, × config.rr_min para asegurar R:R objetivo.
        """
        tf4 = snap.timeframes["4H"]
        last = tf4.bars[-1]
        atr = tf4.indicators.atr or 0
        sl_pct = self.config.sl_profile.get("btc_4h", 2.0)
        lev = leverage_for(snap.symbol, short=False)
        confluence = setup_info.get("confluence")

        # Entry: nivel roto + buffer (T003); fallback a último close si no hay nivel
        if trigger_info and trigger_info.get("level"):
            broken_high = trigger_info["level"]
            entry = broken_high + max(0.1 * atr, broken_high * 0.001)
        else:
            broken_high = None
            entry = last.close

        # SL tactical: 2% bajo entry, nunca menor que confluencia - 0.5*ATR si la tenemos
        sl_price = entry * (1 - sl_pct / 100)

        # TP proyección canónica: `config.tp_leg_multiplier` × medida de pierna
        # (onda C → broken_high). NO usa rr_min — si lo usáramos, rr quedaría
        # siempre igual a rr_min por construcción y la validación R004 nunca
        # fallaría. tp_leg_multiplier es un parámetro estructural del setup.
        tp_mult = self.config.tp_leg_multiplier
        tp_level = None
        leg = None
        if broken_high is not None and confluence is not None:
            leg = broken_high - confluence
            if leg > 0:
                tp_level = broken_high + tp_mult * leg
        if tp_level is None:
            # Fallback: TP = entry + tp_mult × (entry − sl_price)
            tp_level = entry + tp_mult * (entry - sl_price)

        rr = (tp_level - entry) / (entry - sl_price) if entry > sl_price else None
        notes = []
        if rr is not None and rr < self.config.rr_min:
            notes.append(
                f"R:R={rr:.2f} < {self.config.rr_min} (R004) — el motor bloqueará con no_trade"
            )
        if broken_high is None:
            notes.append("sin trigger_info.level — TP derivado de rr_min × SL distance")
        return RiskPlan(
            leverage_cap=lev,
            stop_loss_pct=round(sl_pct, 2),
            stop_loss_price=round(sl_price, 2),
            take_profit_price=round(tp_level, 2),
            rr_ratio=round(rr, 2) if rr else None,
            position_size_pct=1.0 / 15,   # R005: 1 parte de 15 del capital
            notes=notes,
        )

    # ------------- Conditional setups -------------
    def _conditional_no_setup(self, snap: MarketSnapshot, dec: Decision,
                              aligned: bool, setup_info: dict) -> None:
        tf = snap.timeframes.get("4H")
        if not tf or not tf.bars:
            return
        swings = detect_swings(tf.bars, n=self.config.swing_n, atr=tf.indicators.atr, atr_filter_mult=1.0)
        bounds = detect_range(tf.bars, swings)
        last = tf.bars[-1]
        last_high = last_significant_swing(swings, "high")
        last_low = last_significant_swing(swings, "low")
        if aligned and last_high:
            dec.conditional_setups.append(ConditionalSetup(
                rule_id="S001+T003",
                condition=(
                    f"enter_long si precio rompe swing_high 4H {last_high.price:.0f} con "
                    f"cuerpo de vela y volumen >= SMA20"
                ),
                if_triggered_action="enter_long",
                watch_level=round(last_high.price, 2),
                timeframe="4H",
                notes="requiere retroceso previo a MM55+POC (S001) antes de la ruptura",
            ))
        if bounds and not bounds.confirmed:
            dec.reasoning_chain.append(
                f"rango tentativo 4H: low={bounds.low:.0f} high={bounds.high:.0f} amp={bounds.amplitude_pct:.1f}% — sin confirmación"
            )
        if last_low:
            dec.conditional_setups.append(ConditionalSetup(
                rule_id="I002",
                condition=(
                    f"exit_position long / enter_short si precio cierra por debajo de "
                    f"swing_low {last_low.price:.0f} en 4H con volumen"
                ),
                if_triggered_action="exit_position_or_enter_short",
                watch_level=round(last_low.price, 2),
                timeframe="4H",
                notes="disparo de BOS bajista; habilita shorts hacia próximo soporte",
            ))

    def _conditional_pending_trigger(self, snap: MarketSnapshot, dec: Decision,
                                      setup_info: dict, trigger_info: dict) -> None:
        level = trigger_info.get("level")
        if level is None:
            return
        dec.conditional_setups.append(ConditionalSetup(
            rule_id="T003",
            condition=(
                f"enter_long cuando vela 4H cierre > {level:.0f} con volumen >= SMA20"
            ),
            if_triggered_action="enter_long",
            watch_level=round(level, 2),
            timeframe="4H",
            notes="S001 activo; sólo falta el cierre alcista con volumen",
        ))
        # Plus the invalidation watch in case it turns bearish
        tf = snap.timeframes.get("4H")
        swings = detect_swings(tf.bars, n=self.config.swing_n, atr=tf.indicators.atr, atr_filter_mult=1.0) if tf else []
        last_low = last_significant_swing(swings, "low")
        if last_low:
            dec.conditional_setups.append(ConditionalSetup(
                rule_id="S001_invalidation",
                condition=(
                    f"cancelar setup si precio cierra por debajo de {last_low.price:.0f} (swing_low 4H)"
                ),
                if_triggered_action="cancel_setup",
                watch_level=round(last_low.price, 2),
                timeframe="4H",
            ))

    def _conditional_post_tejoden(self, snap: MarketSnapshot, dec: Decision, fb) -> None:
        dec.conditional_setups.append(ConditionalSetup(
            rule_id="C003→S001",
            condition=(
                f"Espera ~48h. Si precio retrocede a MM55+POC en 4H con cuerpo de rechazo → "
                f"buscar reactivación de S001; reevaluar T003 sobre nuevo swing_high"
            ),
            if_triggered_action="enter_long",
            watch_level=fb.level,
            timeframe="4H",
            notes="tejoden en extremo del rango; no perseguir la ruptura fallida",
        ))

    # ------------- finalize -------------
    def _finalize(self, dec: Decision, decision_label: str, confidence: float = 0.0) -> Decision:
        dec.decision = decision_label
        if confidence > 0:
            dec.confidence = confidence
        elif decision_label == "no_trade":
            dec.confidence = 0.9   # alta confianza en no-operar cuando hay blocker
        elif decision_label == "wait":
            dec.confidence = 0.5
        return dec
