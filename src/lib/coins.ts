export interface Coin {
  symbol: string; // e.g. "BTCUSDT"
  base: string; // e.g. "BTC"
  name: string;
  tradingViewSymbol: string; // e.g. "BINANCE:BTCUSDT"
}

export const COINS: Coin[] = [
  { symbol: "BTCUSDT", base: "BTC", name: "Bitcoin", tradingViewSymbol: "BINANCE:BTCUSDT" },
  { symbol: "ETHUSDT", base: "ETH", name: "Ethereum", tradingViewSymbol: "BINANCE:ETHUSDT" },
  { symbol: "BNBUSDT", base: "BNB", name: "BNB", tradingViewSymbol: "BINANCE:BNBUSDT" },
  { symbol: "SOLUSDT", base: "SOL", name: "Solana", tradingViewSymbol: "BINANCE:SOLUSDT" },
  { symbol: "XRPUSDT", base: "XRP", name: "XRP", tradingViewSymbol: "BINANCE:XRPUSDT" },
  { symbol: "ADAUSDT", base: "ADA", name: "Cardano", tradingViewSymbol: "BINANCE:ADAUSDT" },
  { symbol: "DOGEUSDT", base: "DOGE", name: "Dogecoin", tradingViewSymbol: "BINANCE:DOGEUSDT" },
  { symbol: "AVAXUSDT", base: "AVAX", name: "Avalanche", tradingViewSymbol: "BINANCE:AVAXUSDT" },
  { symbol: "DOTUSDT", base: "DOT", name: "Polkadot", tradingViewSymbol: "BINANCE:DOTUSDT" },
  { symbol: "LINKUSDT", base: "LINK", name: "Chainlink", tradingViewSymbol: "BINANCE:LINKUSDT" },
  { symbol: "POLUSDT", base: "POL", name: "Polygon", tradingViewSymbol: "BINANCE:POLUSDT" },
  { symbol: "UNIUSDT", base: "UNI", name: "Uniswap", tradingViewSymbol: "BINANCE:UNIUSDT" },
  { symbol: "ATOMUSDT", base: "ATOM", name: "Cosmos", tradingViewSymbol: "BINANCE:ATOMUSDT" },
  { symbol: "ARBUSDT", base: "ARB", name: "Arbitrum", tradingViewSymbol: "BINANCE:ARBUSDT" },
  { symbol: "NEARUSDT", base: "NEAR", name: "NEAR", tradingViewSymbol: "BINANCE:NEARUSDT" },
  { symbol: "HBARUSDT", base: "HBAR", name: "Hedera", tradingViewSymbol: "BINANCE:HBARUSDT" },
];
