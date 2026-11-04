export interface IchimokuChikouPullbackSignal {
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
  barsSinceCross: number;
  pullbackDistancePct: number;
  signal: 'BUY';
  score: number;
  volumeRatio: number;
  oiChangePct: number;
  fundingRate: number;
  priceChangePct: number;
  marketCap: number;
  volume24h: number;
}

export interface IchimokuChikouPullbackScanResult {
  timestamp: string;
  interval: string;
  exchange: string;
  totalScanned: number;
  matches: IchimokuChikouPullbackSignal[];
}

export interface IchimokuChikouPullbackScanParams {
  symbols?: string;
  limit?: number;
  interval?: string;
  exchange?: string;
}
