# Grid Trading de Futuros (Automático)

## Indicadores necesarios en TradingView
- ADX (Average Directional Index)
- Media móvil simple de 55 períodos (MA55)

## Qué buscar en el gráfico

### Temporalidad: 4 Horas
1. Identificar un **lateral claro** — precio rebotando entre soporte y resistencia
2. Verificar que el **ADX esté por debajo de 23** → confirma que no hay fuerza para romper en ninguna dirección
3. Marcar el **soporte inferior** y la **resistencia superior** del lateral

## Configuración del grid
- **Plataforma:** BingX
- **Dirección:** Solo Long (nunca short en BTC)
- **Apalancamiento:** 10x, posición aislada (nunca cruzada)
- **Rango:** Del soporte al resistencia del lateral en 4H
- **Grids:** Ajustar cantidad hasta que la ganancia por arbitraje quede entre **0.17% y 0.23%** por operación
  - BTC: ~35 grids
  - Oro: ~55-60 grids

## Trigger de activación
- ADX < 23 en 4H ✓
- Lateral confirmado con al menos 2 rebotes en soporte y resistencia ✓
- Precio dentro del rango ✓
→ Activar grid

## Cuándo NO activar
- ADX > 23 con pendiente positiva → hay tendencia, no usar grid
- Precio en caída libre sin soporte definido
- Ya hay otro grid activo

## Gestión
- **Sin stop loss** en BTC
- Si el precio sale del rango por abajo: NO cerrar, esperar a que regrese
- No agregar más capital al grid
- Aceptar de antemano la pérdida total del capital asignado al grid

## Señal de cierre
- Precio rompe resistencia con fuerza + ADX cruza por encima de 23 → cerrar grid con ganancia
- Patrón de cambio de tendencia en gráfico diario → cerrar y reevaluar
