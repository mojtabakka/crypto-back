export interface IchimokuTkCrossSignal {
  symbol: string;
  price: number;
  tenkan: number;
  kijun: number;
  spanA: number;
  spanB: number;
  cloudTop: number;
  cloudBottom: number;
  tenkanPrev: number;
  kijunPrev: number;
  crossType: 'bullish' | 'bearish';
  barsSinceCross: number;
  priceAboveCloud: boolean;
  score: number;
  volumeRatio: number;
  marketCap: number;
  volume24h: number;
  signal: 'BUY';
}

export interface IchimokuTkCrossScanResult {
  timestamp: string;
  interval: string;
  exchange: string;
  totalScanned: number;
  matches: IchimokuTkCrossSignal[];
}

export interface IchimokuTkCrossScanParams {
  symbols?: string;
  limit?: number;
  interval?: string;
  exchange?: string;
}
