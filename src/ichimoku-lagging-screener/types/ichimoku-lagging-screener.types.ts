export interface IchimokuLaggingSignal {
  symbol: string;
  price: number;
  tenkan: number;
  kijun: number;
  spanA: number;
  spanB: number;
  cloudTop: number;
  cloudBottom: number;
  chikouValue: number;
  breakoutLevel: number;
  barsAgo: number;
  signal: 'BUY' | 'SHORT' | 'NEUTRAL';
  score: number;
  marketCap: number;
  volume24h: number;
  volumeRatio: number;
  targetPrice1: number;
  targetPrice2: number;
  stopLoss: number;
  targetProfit1Pct: number;
  targetProfit2Pct: number;
}

export interface IchimokuLaggingScanResult {
  timestamp: string;
  interval: string;
  exchange: string;
  totalScanned: number;
  matches: IchimokuLaggingSignal[];
}

export interface IchimokuLaggingScanParams {
  symbols?: string;
  limit?: number;
  interval?: string;
  exchange?: string;
}

export type OIClassification =
  | 'LONG_BUILDUP'
  | 'SHORT_COVERING'
  | 'LONG_LIQUIDATION'
  | 'SHORT_BUILDUP'
  | 'NEUTRAL';

export type FourFormulaSignal = 'LONG' | 'SHORT' | 'NEUTRAL' | 'STRONG_LONG' | 'STRONG_SHORT';