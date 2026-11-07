export interface IchimokuCloudBottomTouchSignal {
  symbol: string;
  price: number;
  tenkan: number;
  kijun: number;
  spanA: number;
  spanB: number;
  cloudTop: number;
  cloudBottom: number;
  priceDistanceToCloudBottomPct: number;
  wasAboveCloud: boolean;
  barsSinceAboveCloud: number | null;
  bounceProbabilityPct: number;
  signal: 'BUY';
  score: number;
  volumeRatio: number;
  marketCap: number;
  volume24h: number;
}

export interface IchimokuCloudBottomTouchScanResult {
  timestamp: string;
  interval: string;
  exchange: string;
  totalScanned: number;
  matches: IchimokuCloudBottomTouchSignal[];
}

export interface IchimokuCloudBottomTouchScanParams {
  symbols?: string;
  limit?: number;
  interval?: string;
  exchange?: string;
}
