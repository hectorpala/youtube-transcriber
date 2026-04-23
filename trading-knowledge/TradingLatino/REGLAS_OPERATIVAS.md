# Reglas operativas — TradingLatino (Jaime Merino) · v2.1

Capa intermedia de conocimiento operativo. Regeneración completa sobre CEREBRO actualizado (100,674 bytes vs 73,564 de v1.0).

**v2.1 (quirúrgica, 2026-04-21)**: añadidos `action_type` (decision / state_update / reference / advisory / precondition), `priority` por regla (hard_blocker → advisory), `operational_definitions` consumibles por software (swing, BOS, retest, fake breakout), `v0_1_dependencies` para las 13 reglas del subset. Sin cambios en contenido de reglas ni en count total.

- **Trader fuente**: Jaime Merino (TradingLatino)
- **CEREBRO origen**: `CEREBRO.md` (8 secciones, 130+ videos fuente)
- **Generado**: 2026-04-21
- **Estructurado**: `reglas_operativas.json`
- **Total reglas**: **70** (antes v1.0: 84 — consolidación agresiva)
- **Subset v0.1 recomendado**: **13 reglas**

## Qué mejoró en esta pasada

1. **Campo `rule_kind`** con vocabulario cerrado: `context · setup · trigger · invalidation · risk · exit · blocker · indicator_reference · psychology · contradiction`. Permite que un motor de decisión sepa qué puede ejecutar vs qué sólo informa.
2. **`action` depurado**: sólo verbos ejecutables (`enter_long`, `scale_out`, `move_stop_breakeven`, …) o tipos explícitos (`reference`, `advisory`, `precondition`). Nada ambiguo.
3. **Cada `setup`/`trigger`/`invalidation` incluye `conditions + confirmations + invalidations` no vacíos**: validado programáticamente — 0 reglas con invalidaciones vacías en estas categorías.
4. **Consolidación** de reglas redundantes. Menos reglas, cada una más completa. Ejemplos:
   - `R003` fusiona los 4 dimensionamientos de SL (BTC/oro, scalping alts, rango, TRX semanal) en una sola regla con conditions por contexto.
   - `R006` fusiona "max 5-10% por activo" + "diversificar venues" + "cold wallet 50%".
   - `E007` y `I004` se referencian entre sí (invalidación + salida ejecutable del mismo patrón).
5. **Huecos críticos reforzados**:
   - **Trailing/BE**: 7 reglas de `exit` (antes 5), con E001 definiendo el escalón concreto +3%→BE / +7%→+5% / trailing 4-4.5%; E006 meta-framework por temporalidad.
   - **Ruptura/retest/fake breakout**: T003 (ruptura) ahora vincula explícitamente a I007 (fake breakout) e I008 (retest falla) como invalidaciones.
   - **Invalidación**: pasó de 6 a 8 reglas; añadidas I007 (fake breakout) e I008 (retest falla) — conceptos que estaban dispersos.
   - **Estructura**: C001 y C002 combinados como cimiento del `context`. C005 añade "compresión de MMs" como detector de ruptura próxima.
6. **Sección `No-trade zones` del MD** sin títulos vacíos — cada blocker tiene body completo.
7. **Subset v0.1 explícito**: 13 reglas listadas en JSON como `recommended_v0_1_rule_ids` y en este MD al final.

## Criterio de extracción (v2.0)

**Incluido**:
- Reglas reutilizables independientes de precio/fecha
- Setups con contexto + trigger + confirmación + invalidación + acción
- Invalidaciones con criterio de salida duro
- Gestión de riesgo con magnitud medible
- No-trade zones con criterio objetivo
- Uso operativo de indicadores con umbrales concretos

**Excluido**:
- Snapshots de precio puntuales
- Trades históricos por ticker+fecha
- Reglas con evidence_strength=1 sin valor estructural
- Reglas con conditions o invalidations vacías en categorías que las requieren
- Comentarios macro sin acción asociada

Evidencia 1-5: 5=nuclear (≥30 videos); 4=fuerte (15-29); 3=recurrente (5-14); 2=observada (2-4); 1=única.

---

## Contexto de mercado (6)

### C001 · Régimen por timeframe via ADX + pendiente MM55  `[evidencia 5]`
Clasificar cada timeframe leyendo ADX (fuerza) y pendiente de MM55 (dirección). ADX >23 con pendiente positiva = tendencia direccional; pendiente plana o negativa con ADX <23 = lateral/agotamiento. El régimen dicta qué setups están habilitados.

### C002 · Alineación multi-temporal (Triple Pantalla)  `[evidencia 5]`
Entrar sólo cuando semanal (primaria) y diario (secundaria) apunten en la misma dirección que el setup de ejecución en 4H/1H. Si semanal y diario divergen, no operar direccional. Regla base de filtrado para cualquier setup.

### C003 · Detector de 'tejoden' (barrido de liquidez en extremos)  `[evidencia 4]`
Un movimiento que hace nuevo máximo/mínimo del rango y es rechazado con mechazo (≥60% del cuerpo) + cierre dentro del rango previo es barrido de liquidez, no ruptura real. Tras tejoden esperar lateralización ~48h (B002) antes de buscar setup.

### C004 · Centro del lateral con POC vacío = tierra de nadie  `[evidencia 4]`
Cuando el precio cotiza en la mitad del rango y el POC del perfil de volumen coincide con vacío de volumen horizontal, no operar. El mercado no ha decidido dirección; esperar rotación a VAH o VAL. Disparo de B001.

### C005 · Compresión de MMs en lateral prolongado = ruptura violenta próxima  `[evidencia 3]`
MMs (MM55 + EMA20 + EMA10) comprimidas hacia el precio dentro de lateral >30 días = resolución direccional de gran magnitud (~20-30% en BTC). No operar dentro del rango; operar la ruptura confirmada (T003).

### C006 · Noticia macro sin reacción técnica = evento ya descontado  `[evidencia 4]`
Si el precio no reacciona a una noticia direccional esperada (guerra, regulación, fork) o se revierte en <3 velas, el evento está descontado. Ignorar la narrativa; operar el gráfico.

---

## Setups (8)

### S001 · Pauta plana ABC de continuación alcista en 4H  `[evidencia 4]`
**Contexto**: 1W alcista (C001 y C002 alineados).
**Trigger**: Onda C de pauta plana retrocede a confluencia MM55 + POC sin fuerza bajista (ADX plano/negativo, sin divergencia bajista fuerte).
**Confirmaciones**: ausencia de divergencia bajista 4H/1H; OBV/AO sin rojo fuerte; vela de rechazo en el toque.
**Invalidación**: perfora MM55+POC con cuerpo y volumen → cancel_setup. Si ya entraste: I004/E007.
**Acción**: `enter_long`. SL 1.5-2% debajo del valle azul + POC / MM55. TP bajo máximo previo 4H.

### S002 · Grid neutral en rango lateral confirmado  `[evidencia 4]`
**Contexto**: C001 en lateral.
**Trigger**: Rango con ≥2 toques por extremo + amplitud >8-10%.
**Confirmaciones**: POC central dentro del rango; volumen decrece hacia el centro.
**Invalidación**: ruptura confirmada → I002. Cambio de régimen → cancel_setup.
**Acción**: `scale_in` en grid. Apalancamiento 10x máx (oro 10-15x).
**Restricción**: NO abrir en zona tejoden ni persiguiendo precio. Stop duro en parte baja del rango.

### S003 · DCA por tramos de precio (no por fechas), spot  `[evidencia 4]`
**Contexto**: Tendencia mayor alcista o fase de acumulación confirmada.
**Trigger**: Capital segmentado en ≥4 tramos (p.ej. 20% cada −5K USD en BTC; tramos de −10K a −25K para caídas mayores).
**Confirmaciones**: zona de soporte semanal con ≥2 tests previos; F&G ≤30 en el tramo.
**Invalidación**: pérdida de soporte clave con volumen (I002) → cambio estructural a bajista.
**Acción**: `scale_in`. Reservar 40% del capital para el último tramo (compra final).

### S004 · Long en retroceso a MM55 desde parte baja del rango  `[evidencia 3]`
**Contexto**: 1D alcista, estructura de rango.
**Trigger**: Precio en parte baja del rango + retroceso a MM55 en 1H/15min.
**Confirmaciones**: pinbar/envolvente alcista en el toque a MM55; volumen de compra; OBV Monitor verde.
**Invalidación**: cierre de vela bajo MM55 con volumen; nuevo mínimo del rango.
**Acción**: `enter_long`. SL 2%. Nunca shortear activos alcistas con SL 2% (bias asimétrico).

### S005 · Rebote técnico altcoins 3-5 días  `[evidencia 3]`
**Contexto**: Bajista mayor (1W) vigente + suelo redondeado en total-cap altcoins + mínimos más altos en 4H.
**Trigger**: Pullback a MM55 4H + ADX positivo.
**Confirmaciones**: rotación sectorial (alts divergen alcista de BTC plano).
**Invalidación**: pérdida MM55 con volumen; nuevos mínimos bajo el suelo previo.
**Acción**: `enter_long` con TP 15-25%; tomar 12-15% típico.

### S006 · Pool de liquidez DEX con cobertura short automatizada  `[evidencia 3]`
**Contexto**: Pool ETH/USDC o BTC/USDC en rango predefinido.
**Trigger**: Precio toca extremo inferior del rango con volumen.
**Confirmaciones**: API de derivados conectada; capital separado para hedge.
**Invalidación**: Precio vuelve al rango por encima del punto de activación → cancelar hedge.
**Acción**: `hedge` con short 10x (~10% capital del pool). Usar ETH como vehículo cuando no se quiera shortear BTC.

### S007 · Short selectivo en altcoin divergente (BTC alcista)  `[evidencia 3]`
**Contexto**: BTC 1W alcista.
**Trigger**: Altcoin con divergencia bajista propia en 4H/1D + quiebre de línea de tendencia con volumen.
**Confirmaciones**: cruce bajista MM azul sobre marrón en la alt.
**Invalidación**: altcoin rompe al alza con volumen; BTC gira bajista semanal.
**Acción**: `enter_short` contra USD (no contra BTC). Apalancamiento 2-3x.

### S008 · Comprar pánico / vender euforia (spot, sin apalancamiento)  `[evidencia 3]`
**Contexto**: Caída extrema con pánico (F&G ≤20 + volumen capitulación).
**Trigger**: Vela de rechazo en soporte semanal; divergencia alcista RSI sobrevendido.
**Confirmaciones**: volumen capitulación en spike.
**Invalidación**: pérdida de soporte semanal con cierre fuerte y volumen.
**Acción**: `scale_in` spot sin apalancamiento; horizonte ≥3 meses. Vender en F&G ≥64 (E003).

---

## Triggers (5)

### T001 · Long: segunda vela verde tras consolidación (OBV Monitor)  `[evidencia 2]`
Tras consolidación lateral ≥5 velas, activar long en la **segunda** vela verde consecutiva con OBV Monitor en verde. **NO en la primera**. Invalidación: segunda vela no cierra verde.

### T002 · Long rebote: orden LIMIT sobre el soporte, NO en él  `[evidencia 3]`
NUNCA colocar la orden justo en el soporte — el precio suele atravesarlo por barrido. Esperar pinbar/envolvente con mecha ≥70% + volumen de rechazo, luego orden ligeramente por encima del mínimo. Invalidación: cierre de vela por debajo del soporte con volumen.

### T003 · Ruptura: entrada sólo tras cierre de vela con volumen  `[evidencia 3]`
Nunca entrar en ruptura antes del cierre. Colocar orden ligeramente por encima del nivel roto en la siguiente vela. Requiere volumen > promedio de 20 velas. **Alternativa conservadora**: esperar retest exitoso del nivel roto como soporte antes de entrar. Vinculado a I007 (fake breakout) e I008 (retest falla).

### T004 · Long oro/plata: esperar cierre de vela roja SIGUIENTE al mechazo  `[evidencia 2]`
NO entrar en la vela inmediata al rechazo. Esperar a que cierre la siguiente vela roja sin hacer nuevo mínimo. Evita barrido de stops por mecha de continuación.

### T005 · Confluencia MACD alcista + ADX rompiendo 23 + soporte  `[evidencia 3]`
Cruce alcista MACD + ADX cruzando 23 con pendiente positiva + precio en confluencia de soporte (MM55 / POC / VAL). Invalidación: ADX no sostiene pendiente positiva tras el cruce.

---

## Invalidaciones (8)  ← **bloque reforzado en v2.0**

### I001 · Mechazo rechazado en parte alta del lateral (tejoden en ruptura)  `[evidencia 3]`
Ruptura falsa del extremo alto del rango con mechazo + rechazo inmediato + cierre dentro del rango = **no perseguir**. Proyectar nuevo lateral y esperar retroceso a parte baja.

### I002 · Pérdida de soporte clave del rango con volumen = cambio de tendencia  `[evidencia 4]`
Cierre de vela por debajo del soporte del rango + volumen creciente + retest del nivel como resistencia = cambio de tendencia confirmado. **Acción**: `exit_position`; habilita shorts hacia el próximo soporte.

### I003 · Stop saltado = NO reentrar ni doblar (cooldown)  `[evidencia 4]`
Tras perder el stop, no reentrar el mismo setup ni duplicar la posición. La revancha destruye cuentas. Esperar señal NUEVA, no la misma. Duplicar sólo con posición ya ganadora y stop a break-even del doble.

### I004 · Vela verde final + divergencia bajista + quiebre estructura 4H = cerrar longs  `[evidencia 3]`
Confluencia simultánea marca fin del tramo alcista corto. Cerrar o pasar SL a BE+. Contrapartida ejecutable en E007.

### I005 · Cuarto toque a resistencia histórica sin volumen  `[evidencia 2]`
Cuarto test a resistencia con volumen < promedio de intentos previos + divergencia bajista = alta probabilidad de rechazo y corrección ABC. **Acción**: `cancel_setup` long en curso.

### I006 · Ruptura de línea de tendencia con volumen vendedor = cambio real  `[evidencia 3]`
Sólo confirmar cambio de tendencia cuando la línea multi-test se rompe con volumen vendedor dominante. Sin volumen es ruido que se revierte.

### I007 · Fake breakout = mechazo + cierre dentro del rango en la vela siguiente  `[evidencia 3]`  ← **NUEVO**
Una ruptura que en la vela inmediata posterior cierra de vuelta por dentro del rango con mechazo encima del nivel invalida la tesis. Cancelar cualquier entrada generada por T003.

### I008 · Retest falla = nivel roto no respeta como nuevo S/R  `[evidencia 2]`  ← **NUEVO**
Tras una ruptura válida (T003), el nivel roto debe convertirse en soporte (rupturas alcistas) o resistencia (bajistas). Si el retest falla (precio cruza el nivel de vuelta con cuerpo de vela y volumen), la ruptura era falsa. Cerrar y revertir bias.

---

## Gestión de riesgo (10)  ← **consolidado**

### R001 · Apalancamiento máximo por categoría  `[evidencia 5]`
- BTC / oro: hasta 10x
- Altcoins perpetual: 3-5x
- Short futuros: 3x
- BitMEX/Bitfinex shorts alts en bajista: 2-3x
- **BitMEX regla dura: nunca >10x**
- BitMEX/Bybit: máximo 2 ops simultáneas con capital real (no el apalancamiento disponible)

### R002 · Stop loss obligatorio en futuros cripto  `[evidencia 4]`
Usar SIEMPRE SL en futuros cripto; **NO cerrar manualmente antes de que toque el stop**. Excepciones estrictas: oro con apalancamiento bajo; acciones con manipulación probable en aislado (70/30).

### R003 · Dimensionamiento de SL por perfil de activo  `[evidencia 4]`  ← **consolidada**
| Contexto | SL típico |
|---|---|
| BTC / oro / criptos líquidas 4H | 1.5-2% (hasta 3% según volatilidad) |
| Scalping altcoins | 10% |
| Operativa de rango | 4-5% |
| Activos muy volátiles semanales (TRX) | 20% |

SL debajo de MM55+POC cuando aplique. Si stop natural requerido > máximo por categoría → no operar.

### R004 · R:R mínimo 1:2 (ideal 1:3); TP cubre 3 stops  `[evidencia 3]`
No abrir trade con R:R <1:2. Ideal 1:3. Con 7/10 aciertos + stops 5-10% + targets 5-15%, operativa rentable. TP debe cubrir mínimo 3 stop loss consecutivos.

### R005 · División del capital: 40/30/20/10  `[evidencia 3]`
40% mensual (holding), 30% semanal, 20% diario, 10% futuros. Capital total en 15-20 partes; máx 1 parte por trade. ≤30% del capital en operaciones simultáneas.

### R006 · Máx 5-10% por activo + diversificar venues  `[evidencia 3]`  ← **fusiona 3 reglas v1.0**
Máx 5-10% por activo en cartera 3 meses. Nunca 100% en un cripto. Adicional: no concentrar >30% por exchange; cold wallet 50% / exchange 50%.

### R007 · Reserva mínima: nunca 100% cripto ni 100% USD  `[evidencia 2]`
Mantener siempre ≥10-20% en BTC y ≥10-20% en USDT/USDC. USDT/USDC sólo como tránsito hacia BTC; BTC en cold wallet.

### R008 · No apalancadas overnight fin de semana  `[evidencia 3]`
No dejar posiciones apalancadas el fin de semana. CEX con baja liquidez = barridos; caídas tipo $90K→$60K en BTC ocurren fin de semana por manipulación coordinada.

### R009 · Ajustar tamaño a volatilidad con mismo apalancamiento  `[evidencia 2]`
Oro a 10x permite más capital que BTC a 10x por stop natural más estrecho. Dimensionar por exposición-equivalente, no por capital nominal. Si el stop natural requerido excede el cap de R001/R003, no operar.

### R010 · NO SL en zonas técnicas evidentes (stop-hunting)  `[evidencia 2]`
En cripto, zonas obvias (debajo de soporte clave, encima de resistencia, niveles redondos) son imanes para bots/exchanges. Usar stop mental o alejar el SL un rango adicional. Conflicto con R002 → preferir SL mental + monitoreo activo.

---

## Gestión de salida (7)  ← **bloque reforzado en v2.0**

### E001 · Trailing manual escalonado: +3%→BE, +7%→+5%, luego trailing 4-4.5%  `[evidencia 3]`
Regla dura de trailing para longs en ganancia:
1. Llega a **+3%** → mover SL a **BE**
2. Llega a **+7%** → mover SL a **+5%**
3. Desde ahí, **trailing 4-4.5%** detrás del precio

Aplica a BTC 4H y swing diario. Scalping (5-15min): trailing más ajustado 2-3%. Spot mensual: no usar trailing, mantener holding.

### E002 · Mover SL a BE apenas precio avance margen operativo  `[evidencia 3]`
Tan pronto como el precio avance ≥1 ATR (o el margen operativo del setup), subir SL a BE. Si rompe BE, salir y NO reentrar en el mismo setup.

### E003 · Descargar 20-50% en zona alta / resistencia clave  `[evidencia 3]`
En zona alta del rango o resistencia multi-test, descargar 20-50% aunque el target teórico sea mayor. No esperar al techo exacto. Confirmado por F&G ≥64 + divergencia bajista emergente + volumen decreciente.

### E004 · Vender 50% al pasar a verde tras recompras escalonadas  `[evidencia 1]`
Tras recompras que recuperan una posición perdedora, vender 50% apenas pase a verde. Recupera margen de maniobra; mantener el otro 50% hacia el target.

### E005 · No TP fijo en cripto: dejar correr con SL móvil  `[evidencia 2]`
No usar TP fijos en cripto. Dejar correr con E001/E002. Cripto da movimientos grandes que se pierden con TP fijo.

### E006 · Gestión de salida escalonada por temporalidad  `[evidencia 1]`  ← **meta-framework**
- **Futuros**: tomar ganancias activamente (E001/E003).
- **Spot diario**: vender al aparecer señales de agotamiento.
- **Spot semanal**: vender sólo con patrón de salida confirmado (divergencia + ruptura).
- **Spot mensual**: no vender (holding largo plazo).

### E007 · Cerrar long con vela verde final + divergencia bajista + quiebre estructura 4H  `[evidencia 3]`
Ejecutable cuando I004 se dispara con posición abierta. Contrapartida de la invalidación.

---

## No-trade zones / Blockers (11)  ← **sección completa, ningún título vacío**

### B001 · Centro del lateral con POC vacío  `[evidencia 4]`
Régimen lateral + precio central + POC en vacío horizontal = no operar direccional. Ver C004 para detección. Esperar rotación a VAH o VAL.

### B002 · Tejoden activo (~48h de espera)  `[evidencia 4]`
Con C003 disparado, esperar ~48h antes de buscar setup direccional. En alta volatilidad post-barrido no inventar entradas. Invalidación: cierre sostenido fuera del rango con volumen.

### B003 · Rupturas en plena volatilidad (ATR >2× normal)  `[evidencia 3]`
No entrar en rupturas durante volatilidad explosiva. La caza de stops está activa. Esperar pullback a MM55/POC/VAL. Si el pullback rechaza sobre el nivel roto, el setup se habilita (T003 con retest).

### B004 · BTC el fin de semana  `[evidencia 3]`
No operar BTC el fin de semana (viernes cierre NY → domingo 20:00 UTC) por baja liquidez y manipulación en CEX. Identificar el setup y ejecutarlo al abrir la semana.

### B005 · No shortear BTC contra tendencia semanal mayor  `[evidencia 4]`
Si BTC 1W es alcista, no abrir shorts de BTC aunque el 4H muestre fin de tramo. La estructura manda. Sí se puede shortear altcoins divergentes (S007).

### B006 · Perseguir precio / FOMO / F&G ≥64 en zona alta  `[evidencia 4]`
No entrar long topando máximos del rango ni tras rallies sin pullback. F&G ≥64 confirma zona de salida (E003), no de compra. Aplica también a rallies tipo "$99K→$108K sin pullback" históricamente.

### B007 · Operar bajo estrés, ansiedad o urgencia económica  `[evidencia 2]`
No operar si el estado emocional está comprometido o si hay urgencia económica. *"Urgencia = pérdida"*. La presión financiera fuerza entradas malas y amplifica el daño emocional del stop.

### B008 · Setups / activos desconocidos (círculo de competencia)  `[evidencia 2]`
Operar sólo patrones validados previamente por el trader. No improvisar con setups desconocidos aunque parezcan oportunidades. Respetar el círculo de competencia.

### B009 · Acumulación con mínimos decrecientes + volumen bajo  `[evidencia 2]`
No operar acumulación con mínimos decrecientes y volumen bajo hasta confirmación en 4H (cruce alcista MACD). Evitar ruido de 1H — demasiado scalping sin estructura.

### B010 · Rangos muy estrechos (<0.5% amplitud BTC)  `[evidencia 2]`
Rangos <0.5% del precio no se operan dentro del rango. La salida suele ser un movimiento direccional violento. Operar sólo la ruptura confirmada (T003).

### B011 · Niveles psicológicos redondos (000, 700)  `[evidencia 2]`
No ejecutar entradas exactas en niveles terminados en '000' o '700'. Son zonas de barrido de liquidez (clusters de stops). Esperar el barrido antes de entrar.

---

## Indicadores (referencia operativa) (8)

### IR001 · MM55 como referencia estructural en 4H/1D/1W  `[evidencia 5]`
Referencia principal de tendencia, techo dinámico, soporte dinámico, zona de recompra. En bajista los rebotes apuntan a MM55 antes de continuar cayendo. Tras cruce alcista de medias, primer toque a MM55 suele rechazar (oportunidad short corto antes de continuación mayor).

### IR002 · ADX como clasificador de régimen y fuerza (punto 23)  `[evidencia 5]`
Punto clave 23 (también 20). Pendiente positiva = tendencia; negativa o ADX <23 = lateral/agotamiento. Validar, no anticipar. ADX <23 con MACD tocando cero sin que baje el precio = señal alcista temprana.

### IR003 · MACD: momentum y divergencias, no cruces en caídas violentas  `[evidencia 4]`
Útil para momentum y divergencias (precio vs MACD 4H/1H). Cruces poco confiables en caídas violentas. Convergencia alcista en 1H como señal temprana. En bajista fuerte las señales clásicas se invierten (trampa).

### IR004 · RSI: útil en rangos; en bajista fuerte no sirve  `[evidencia 3]`
Sobreventa relativa entre temporalidades; divergencia alcista en sobreventa como señal de rebote. En tendencia bajista fuerte todo está sobrevendido — RSI deja de ser útil.

### IR005 · POC + VAH/VAL como referencia estructural de rango  `[evidencia 4]`
POC como referencia de SL (colocar debajo) y confluencia con MM55 para validar entrada. VAH/VAL delimitan área de valor. Cruce del POC = posible cambio direccional. SL 8% bajo POC en setups alt diarios.

### IR006 · Divergencia precio vs RSI/MACD = señal temprana de agotamiento  `[evidencia 4]`
Divergencia bajista (precio hace máximos más altos, oscilador no) anticipa rango-caída, doble techo, quiebre de estructura. Divergencia alcista en sobreventa + soporte respetado = rebote.

### IR007 · Fear & Greed ≥64 = zona de salida  `[evidencia 3]`
F&G ≥64 coincide con techo de rango. Extrema avaricia confirma barrida preparada por ballenas. Confirmación de escala de salida (E003), no trigger de short.

### IR008 · Exceso de longs en BitMEX/derivados = señal contraria  `[evidencia 2]`
Long/short ratios con exceso de longs = el precio buscará liquidar esos longs antes de cualquier rebote real. Bias contrario al consenso.

---

## Psicología operativa (3)

### P001 · Precondición: aceptar el stop como coste antes de entrar  `[evidencia 3]`
Preguntarse explícitamente "qué pasa si salta el stop" y aceptar el riesgo. Si no se acepta, no operar. Regla de precondición para cualquier trade.

### P002 · Estar fuera del mercado es una posición válida  `[evidencia 2]`
Sin confluencia clara, no operar es correcto — especialmente en laterales de baja volatilidad. Alternativa: generar ingresos pasivos (pools/grids) para convertir la espera en rendimiento.

### P003 · Contrarian cuando el consenso técnico es evidente  `[evidencia 3]`
Cuando todas las masas ven una señal bajista clara por indicadores tradicionales, suele haber un impulso alcista previo por psicología de masas antes del movimiento real. Confluencia con IR008.

---

## Contradicciones / reglas con cautela (4)

### X001 · Apalancamiento máx 10x vs ejemplos 20x  `[evidencia 5]`
Regla dura R001 (≤10x BTC/oro; 3-5x alts). Ejemplos con 20x son capital simbólico didáctico — **no permiso operativo**. Prevalece R001.

### X002 · Fibonacci útil vs rechazado en cripto  `[evidencia 3]`
Se usa para proyectar onda C; en 2025 el autor lo rechaza en cripto por manipulación. Usar sólo como confluencia secundaria, nunca como trigger único.

### X003 · BTC refugio vs BTC cae con índices en crisis  `[evidencia 3]`
En crisis macro aguda BTC se comporta como especulativo (precedente marzo 2020). En estrés moderado admite papel parcial de 'refugio'. Tratarlo como contexto-dependiente.

### X004 · Squeeze Momentum vs Estocástico  `[evidencia 2]`
Squeeze Momentum en videos antiguos; en 2025 el autor lo declara obsoleto y recomienda Estocástico con canal morado. Preferir Estocástico.

---

## DEFINICIONES_OPERATIVAS_V0_1

Definiciones mínimas consumibles por software para implementar estructura de mercado. Versionadas en `reglas_operativas.json` → `operational_definitions`.

### swing_high / swing_low
Vela cuyo máximo (o mínimo) es estrictamente mayor (o menor) que los de N velas adyacentes antes y después. `default_N=3` para 4H; `N=3-5` para diario. Filtrar swings con altura mínima ≥ 1×ATR para reducir ruido.

Secuencia de swings define la estructura:
- HH + HL (higher-highs + higher-lows) = estructura alcista
- LH + LL (lower-highs + lower-lows) = estructura bajista

### break_of_structure (BOS)
En estructura alcista, el precio rompe con **cuerpo de vela** por debajo del último `swing_low` significativo → cambio estructural a bajista. Simétrico al revés.

Confirmación: cierre de vela en el lado contrario al swing relevante **+** volumen ≥ promedio de 20 velas.

Usado por: `I002`, `I006`.

### retest_valido
Tras ruptura confirmada de un nivel (T003), el precio regresa al nivel roto y lo **respeta** como nuevo soporte (ruptura alcista) o resistencia (ruptura bajista), con vela de rechazo.

Confirmación: pinbar/envolvente sobre/bajo el nivel **+** precio NO cierra de vuelta dentro del rango previo **+** volumen de rechazo > volumen de retest.

Usado por: `T003`, `I008`.

### fake_breakout
Ruptura aparente seguida, en 1-3 velas, de **cierre de vuelta dentro del rango previo** con mechazo por encima/debajo del nivel (mecha ≥60% del cuerpo).

Acción: `cancel_setup` si hay orden pendiente; `exit_position` si ya se entró.

Usado por: `I001`, `I007`.

### rango_lateral_confirmado
Zona con ≥2 tests al extremo superior y ≥2 al extremo inferior, sin ruptura, amplitud ≥8% del precio medio. Amplitud <0.5% → B010 (no operar dentro).

Usado por: `S002`, `B010`.

### tejoden
Fake breakout aplicado a los extremos del rango principal. Barrido de liquidez con mecha ≥60% + cierre dentro del rango + ADX sin fuerza en la dirección de la ruptura. Espera ~48h antes de buscar setup direccional.

Usado por: `C003`, `B002`, `I001`, `I007`.

---

## REGLAS_V0_1_RECOMENDADAS

Subset mínimo para un motor de decisión v0.1 que pueda evaluar charts en vivo con datos estándar (OHLCV + MM55 + ADX + MACD + POC + volumen).

### Criterio
- Evidencia ≥3 (excluye evidence=1 y reglas débiles)
- Acción ejecutable (no `reference`, `advisory`, `precondition`)
- Inputs disponibles desde chart estándar (excluye OBV Monitor propio, F&G, emotional_flag)
- Cubre los 5 pilares: contexto · setup · trigger · invalidación · gestión (riesgo + salida)

### Lista (13 reglas — con priority + action_type + deps v2.1)

| ID | priority | action_type | action | deps | Título | Ev |
|---|---|---|---|---|---|---|
| **C001** | primary_context | state_update | classify_regime | — | Régimen via ADX + MM55 | 5 |
| **C002** | primary_context | state_update | filter_setup | C001 | Alineación multi-temporal | 5 |
| **C003** | primary_context | decision | wait | C001 | Detector tejoden | 4 |
| **S001** | primary_setup | decision | enter_long | C001, C002 | Pauta plana ABC long 4H | 4 |
| **T003** | trigger | decision | enter_long | S001 | Ruptura tras cierre + volumen | 3 |
| **I002** | exit_rule | decision | exit_position | — | Pérdida de soporte con volumen | 4 |
| **I003** | hard_blocker | decision | no_trade | — | Stop saltado → no reentrar | 4 |
| **I007** | exit_rule | decision | cancel_setup | T003 | Fake breakout | 3 |
| **R001** | risk_rule | precondition | size_cap | — | Apalancamiento máximo por categoría | 5 |
| **R002** | hard_blocker | precondition | require_stop | — | SL obligatorio en futuros | 4 |
| **R003** | risk_rule | precondition | require_stop | R001 | Dimensionamiento SL por perfil | 4 |
| **E001** | exit_rule | decision | trail_stop | — | Trailing escalonado BE/+5%/4.5% | 3 |
| **B005** | blocker | decision | no_trade | C001 | No shortear BTC contra 1W | 4 |

Evidencia promedio del subset: **4.1** · Kind coverage: context (3), setup (1), trigger (1), invalidation (3), risk (3), exit (1), blocker (1).

### Algoritmo mínimo recomendado (v0.1)

1. Ingesta OHLCV + MM55 + ADX + MACD + volumen + POC
2. Clasificar régimen por timeframe (**C001**)
3. Verificar alineación multi-temporal (**C002**)
4. Evaluar blockers: **B005** (short contra BTC 1W), **C003** (tejoden activo)
5. Si no hay blocker, buscar setup **S001** (pauta plana ABC)
6. Validar trigger **T003** (ruptura tras cierre con volumen)
7. Verificar invalidaciones inmediatas: **I002**, **I007**
8. Dimensionar según **R001**, **R002**, **R003**
9. Configurar gestión de salida con **E001**
10. Emitir decisión con `reasoning_chain` y SL sugerido

---

## PARA MOTOR DE DECISIÓN (inputs esperados)

Esquema resumido — ver `reglas_operativas.json` → `para_motor_de_decision` para inputs detallados por regla.

### Market data
- OHLCV `15m · 1H · 4H · 1D · 1W` (lookback 365-500 velas)
- Perfil de volumen (VRVP/VPVR): POC, VAH, VAL
- Flag fin de semana / mantenimiento / hard fork

### Indicators
- MM55 (4H/1D/1W) — referencia estructural
- EMA 10 / 20 — referencia intradía
- ADX con umbral 23 — clasificador de régimen
- MACD — momentum y divergencias
- RSI — sobreventa (sólo rangos)
- Bollinger + Keltner — squeeze
- ATR — dimensionamiento de stops

### Estructura
- Trend por timeframe (alcista/lateral/bajista)
- Swing highs/lows
- Range boundaries
- Soporte/resistencia con ≥2 tests
- Elliott ABC
- Tejoden detector

### Sentimiento / derivados
- Long/short ratios (BitMEX, Binance futures)
- Fear & Greed 0-100

### Estado del trader (si disponible)
- Flag emocional / urgencia económica
- Timestamp del último stop tocado (cooldown)

### Outputs esperados
```
regime: tendencial_alcista | tendencial_bajista | lateral | tejoden | indefinido
decision: enter_long | enter_short | scale_in | scale_out | exit | wait | no_trade | hedge
confidence: 0.0-1.0
applicable_rule_ids: [...]
blocking_rule_ids: [...]
suggested_sizing: { leverage, pct_capital, stop_loss_pct }
reasoning_chain: referencia explícita a reglas
```

---

## Qué sigue después (fuera del alcance de esta regeneración)

- **Fase Motor v0.1**: implementar evaluador de charts sobre las 13 reglas del subset. Entrada: snapshot OHLCV + indicadores. Salida: `decision + reasoning_chain`.
- **Fase Motor v0.2**: incorporar reglas de indicadores propios (OBV Monitor, Valle Verde) mapeadas a equivalentes estándar.
- **Fase Motor v0.3**: incluir reglas con inputs de sentimiento/derivados.
- **Refinamiento continuo de reglas**: revisar cada 3-6 meses con CEREBRO actualizado y ajustar evidencias/consolidaciones.
