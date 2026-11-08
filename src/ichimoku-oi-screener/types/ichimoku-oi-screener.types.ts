export type OIClassification =
  | 'LONG_BUILDUP'
  | 'SHORT_COVERING'
  | 'LONG_LIQUIDATION'
  | 'SHORT_BUILDUP'
  | 'NEUTRAL';

export type FourFormulaSignal = 'STRONG_LONG' | 'LONG' | 'NEUTRAL' | 'SHORT' | 'STRONG_SHORT';

export interface IchimokuOISignal {
  symbol: string;
  price: number;
  priceChangePct: number;
  oiChangePct: number;
  volumeRatio: number;
  fundingRate: number;
  classification: OIClassification;
  fourFormulaSignal: FourFormulaSignal;
  fourFormulaScore: number;
  tenkan: number;
  kijun: number;
  spanA: number;
  spanB: number;
  cloudTop: number;
  cloudBottom: number;
  chikouValue: number;
  breakoutLevel: number;
  barsSinceCross: number;
  signal: 'BUY';
  score: number;
  marketCap: number;
  volume24h: number;
}

export interface IchimokuOIScanResult {
  timestamp: string;
  interval: string;
  exchange: string;
  totalScanned: number;
  ichimokuMatches: number;
  analyzedMatches: number;
  oiFilteredMatches: number;
  matches: IchimokuOISignal[];
}

export interface IchimokuOIScanParams {
  symbols?: string;
  limit?: number;
  interval?: string;
  exchange?: string;
}
