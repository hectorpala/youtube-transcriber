# Gestión de Riesgo

## Apalancamiento máximo por activo
| Activo | Max apalancamiento | Stop loss |
|--------|-------------------|-----------|
| BTC futuros | 10x | No usa (acepta pérdida total del grid) |
| Oro futuros | 10-15x | No usa si tendencia clara |
| Plata futuros | 10x | No usa si tendencia clara |
| Altcoins futuros | 3-5x | Siempre, 3-5% |
| Índices | 5x | Siempre, 2% |

## Cuándo usar stop loss
| SÍ usar stop | NO usar stop |
|--------------|--------------|
| Operando contra la tendencia del diario | BTC spot (nunca) |
| Altcoins apalancadas | BTC futuros con diario alcista |
| Índices apalancados | Oro/plata con tendencia alcista clara |
| Cualquier activo que no sea BTC/ETH/oro | Grid de futuros (se acepta la liquidación) |

## Posición: siempre aislada
- **Nunca** usar margen cruzado
- Posición aislada = si se liquida, solo pierde esa posición, no la cuenta entera

## Máximo de operaciones simultáneas
- **2 operaciones abiertas** como máximo
- 1 grid de BTC + 1 posición en oro, por ejemplo
- Nunca 3 o más simultáneas

## Gestión de grid en pérdida
1. El grid sale del rango y está en rojo → **NO cerrar**
2. **NO agregar más capital** para bajar el punto de liquidación
3. Esperar a que el precio regrese al rango
4. Si llega al punto de liquidación → aceptar la pérdida, ya estaba presupuestada

## Separación spot vs futuros (mental y de capital)
- **Spot es sagrado** — nunca se vende en pérdida, nunca se mezcla con futuros
- **Futuros es riesgo** — capital que aceptas perder completo (10% del total)
- No confundir "comprar spot" con "abrir un long apalancado"
- Spot → billetera fría
- Futuros → exchange, capital limitado

## Ratio esperado
- 6-7 aciertos por cada 3 fallos en futuros
- Aceptar -10% temporal en cuenta de futuros (2 stops de -20% + 1 ganancia de +30%)

## Regla máxima
- Máximo **30% del capital digital total** en exchanges
- El 70% restante en billetera fría o DeFi
- Nunca operar con dinero que necesitas para vivir
