# Pools de Liquidez DeFi (Ingreso Pasivo)

## Plataforma y configuración
- **DEX:** Uniswap V3 (liquidez concentrada)
- **Par principal:** ETH/USDC
- **Wallet:** MetaMask + billetera fría
- **Cobertura:** Short de protección vía API en exchange centralizado (Hyperliquid / BingX)

## Qué buscar en el gráfico para configurar el pool

### Temporalidad: Diario de ETH
1. Identificar un **rango lateral** claro en ETH
2. Marcar soporte inferior y resistencia superior
3. Ese rango es el que se configura en Uniswap como rango de liquidez concentrada
4. Mientras ETH se mantenga dentro del rango → genera comisiones

## Configuración del pool
- **Rango:** Soporte a resistencia del lateral en diario de ETH
- **Rendimiento estimado:** ~50-100% anual en comisiones
- **Cobro de comisiones:** Mensual

## Short de protección (hedging automático)
- Si ETH sale del rango **por abajo** (cae debajo del soporte):
  1. Se activa automáticamente un **short 10x** en exchange centralizado vía API
  2. El short compensa el impermanent loss del pool
  3. Si ETH regresa al rango → se cancela el short automáticamente
- Esto lo manejan **bots automatizados** (DeFi Suite)

## Cuándo crear el pool
- ETH en lateral confirmado en diario
- ADX < 23 en diario de ETH → sin tendencia, ideal para pool
- Capital que NO necesitas para trading activo

## Cuándo NO crear el pool
- ETH en tendencia fuerte (alcista o bajista)
- ADX > 23 con pendiente marcada
- No tienes la infraestructura de short de protección configurada

## Regla de capital
- Los pools son para el capital **grande** (la mayor parte del patrimonio)
- Futuros son para capital **pequeño** y especulativo
- Nunca mezclar: el pool genera ingreso pasivo, los futuros son riesgo activo
