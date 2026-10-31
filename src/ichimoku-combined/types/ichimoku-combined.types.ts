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
}

export interface IchimokuCombinedScanResult {
  timestamp: string;
  interval: string;
  totalScanned: number;
  matches: IchimokuCombinedSignal[];
}

export interface IchimokuCombinedScanParams {
  symbols?: string;
  limit?: number;
  interval?: string;
}
