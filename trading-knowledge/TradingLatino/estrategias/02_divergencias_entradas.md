# Divergencias y Entradas en Futuros

## Indicadores necesarios en TradingView
- ADX (Average Directional Index) — nivel clave: **23**
- Squeeze Momentum Indicator (lo que Jaime llama "el monitor")
- Media móvil simple de 55 períodos (MA55)
- Media móvil simple de 10 períodos (MA10)

## Qué buscar en el gráfico

### Paso 1 — Semanal: determinar contexto
- ¿Estamos en lateral, alcista o bajista?
- Si estamos en la **parte baja de un lateral semanal** → buscar divergencia alcista en diario

### Paso 2 — Diario: detectar divergencia alcista en formación
- El precio hace **mínimos iguales o más bajos**
- Pero el Squeeze Momentum / ADX tiene **pendiente positiva** (mínimos más altos)
- Eso es una **divergencia alcista en formación**
- Tarda 2-3 días en completarse desde que se identifica

### Paso 3 — 4 Horas: buscar zona de entrada
- Buscar precio lo más cercano a la **MA55** (punto de control)
- Verificar ADX en 4H:
  - **ADX < 23** → sin fuerza, esperar o usar grid
  - **ADX > 23 con pendiente positiva** → hay fuerza alcista, buscar entrada
  - **ADX pendiente negativa + DX con direccionalidad alcista** → próximo rebote

### Paso 4 — 1 Hora: precisión de entrada
- Esperar una **vela roja** después de un retroceso
- Entrar long al cierre de esa vela
- El patrón en 1H dura **10-12 horas** (entras de noche, sales al mediodía)

## Trigger de entrada
1. Semanal en lateral, parte baja ✓
2. Diario con divergencia alcista en formación ✓
3. Precio cerca de MA55 en 4H ✓
4. Vela roja en 1H como retroceso ✓
→ Entrar long

## Stop loss
| Contexto | Stop |
|----------|------|
| BTC spot | Nunca |
| BTC futuros con diario alcista | No usa stop, acepta pérdida del grid |
| Futuros contra tendencia diaria | 3-5% |
| Altcoins apalancadas | Siempre, 3-5% |

## Señal de salida
- **No salir por estar ganando** — salir cuando aparezca el **patrón de salida**
- En 1H: target es la siguiente resistencia (~10 horas de hold)
- En 4H: target es la zona donde MA10 se aleja de MA55 con verticalidad

## Patrón "Te Joden" (trampa a evitar)
- El precio llega al **punto de control** (MA55)
- Sube y **supera el máximo anterior**
- Inmediatamente **cae**
- Los que entraron en la ruptura quedan atrapados
- **Regla:** NO operar rupturas. Esperar retroceso después de la ruptura falsa.

## Resumen del flujo
```
SEMANAL → ¿Lateral parte baja? → SÍ
  ↓
DIARIO → ¿Divergencia alcista en formación? → SÍ
  ↓
4H → ¿Precio cerca de MA55? ¿ADX > 23? → SÍ
  ↓
1H → ¿Vela roja de retroceso? → ENTRAR LONG
  ↓
SALIR → Cuando aparezca patrón de salida, no antes
```
