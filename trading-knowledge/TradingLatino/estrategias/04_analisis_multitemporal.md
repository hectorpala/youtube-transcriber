# Análisis Multi-Temporal (Metodología Core)

## Indicadores necesarios en TradingView
- Media móvil simple de **55 períodos** (MA55) — soporte/resistencia dinámico, "punto de control"
- Media móvil simple de **10 períodos** (MA10) — señal rápida
- **ADX** (Average Directional Index) — fuerza de tendencia, umbral en **23**
- **Squeeze Momentum Indicator** — "el monitor", da señal anticipada de movimiento

## Jerarquía de temporalidades

| Temporalidad | Para qué sirve | Tipo de operación | Duración del trade |
|-------------|----------------|-------------------|-------------------|
| Semanal | Tendencia principal | Inversión spot, HODL | Meses |
| Diario | Dirección de la semana | Trading spot | Semanas |
| 4 Horas | Zona de entrada en futuros | Swing trading | 2-4 días |
| 1 Hora | Precisión de entrada | Intradía / futuros | ~10 horas |

**Regla:** La temporalidad superior siempre manda. Operar 1H a favor de 4H. Operar 4H a favor de diario.

## Qué buscar en cada temporalidad

### Semanal
- ¿MA55 tiene pendiente positiva? → Tendencia alcista, se puede comprar spot
- ¿Precio por encima de MA55? → Alcista
- ¿Precio por debajo de MA55? → Precaución, buscar divergencias en diario
- ¿Lateral? → Operar los extremos del rango

### Diario
- ¿Hay divergencia alcista en formación? (Squeeze Momentum con pendiente positiva + precio corrigiendo)
- ¿Precio cerca de MA55? → Zona de interés para entrada
- ¿ADX > 23? → Hay fuerza, buscar entrada a favor de la tendencia
- ¿ADX < 23? → Sin fuerza, lateral, usar grid o esperar

### 4 Horas
- Buscar entrada lo más cerca posible de la **MA55** (punto de control)
- ¿MA10 se acerca a MA55 y luego se separa con verticalidad? → Señal de movimiento
- ¿ADX cruza hacia arriba del 23? → Viene movimiento fuerte
- Rango del lateral en 4H → Define grid o zona de entrada

### 1 Hora
- "Lupa" del gráfico de 4H — mismos patrones pero más detallados
- Entrada de precisión: esperar **vela roja de retroceso** para entrar long
- Hold: ~10 horas (entras de noche, sales al mediodía)
- Target: siguiente resistencia visible en 1H

## Concepto de fractales
- El mismo patrón (lateral → ruptura → "te joden" → continuación) se repite **idéntico** en todas las temporalidades
- Si identificas un fractal en 1H, búscalo formándose en 4H
- Si se está formando en 4H, proyéctalo al diario
- Los fractales confirman la dirección del siguiente movimiento

## Señales clave del ADX
| Condición del ADX | Significado | Acción |
|-------------------|-------------|--------|
| ADX < 23 | Sin fuerza, lateral | Grid automático o esperar |
| ADX > 23, pendiente positiva | Tendencia con fuerza | Operar a favor |
| ADX > 23, pendiente negativa | Fuerza se agota | Preparar salida |
| ADX girando de abajo hacia arriba | Viene explosión | Preparar entrada |

## Señales de la MA55
| Condición | Significado |
|-----------|-------------|
| Precio rebota en MA55 por arriba | MA55 es soporte → alcista |
| Precio rechazado en MA55 por abajo | MA55 es resistencia → bajista |
| MA10 cruza MA55 hacia arriba | Cambio de tendencia alcista |
| MA10 se separa de MA55 con verticalidad | Movimiento fuerte en curso |
| Precio lateraliza alrededor de MA55 | Indecisión, esperar ruptura |

## Flujo de análisis completo
```
1. SEMANAL: ¿Alcista, bajista o lateral?
   ↓
2. DIARIO: ¿Divergencia? ¿ADX > o < 23? ¿Precio vs MA55?
   ↓
3. 4H: ¿Dónde está el punto de control (MA55)?
        ¿Se está formando el mismo fractal que en diario?
   ↓
4. 1H: ¿Vela roja de retroceso para entrar?
        ¿MA10 separándose de MA55?
   ↓
5. EJECUTAR a favor de la temporalidad superior
```
