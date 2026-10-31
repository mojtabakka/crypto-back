export interface IchimokuLaggingSpanSignal {
  symbol: string;
  price: number;
  chikouValue: number;
  crossCandleIndex: number;
  crossTime: number;
  crossPriceHigh: number;
  barsAgo: number;
  signal: 'BUY';
}

export interface IchimokuLaggingSpanScanResult {
  timestamp: string;
  interval: string;
  totalScanned: number;
  matches: IchimokuLaggingSpanSignal[];
}

export interface IchimokuLaggingSpanScanParams {
  symbols?: string;
  limit?: number;
  interval?: string;
}
