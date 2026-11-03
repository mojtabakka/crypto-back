export interface IchimokuCombinedSignal {
  symbol: string;
  price: number;
  tenkan: number;
  kijun: number;
  spanA: number;
  spanB: number;
  cloudTop: number;
  cloudBottom: number;
  chikouValue: number;
  crossPriceHigh: number;
  barsAgo: number;
  signal: 'BUY';
  score: number;
  volumeRatio: number;
  oiChangePct: number;
  fundingRate: number;
  priceChangePct: number;
  marketCap: number;
  volume24h: number;
}

export interface IchimokuCombinedScanResult {
  timestamp: string;
  interval: string;
  exchange: string;
  totalScanned: number;
  matches: IchimokuCombinedSignal[];
}

export interface IchimokuCombinedScanParams {
  symbols?: string;
  limit?: number;
  interval?: string;
  exchange?: string;
}
