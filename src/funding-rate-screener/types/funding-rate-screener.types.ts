export interface FundingRateSignal {
  symbol: string;
  price: number;
  fundingRate: number;
  fundingRatePct: number;
  timeframe: string;
  nextFundingTime: number | null;
  signal: 'SHORT' | 'NEUTRAL';
  score: number;
}

export interface FundingRateScanResult {
  timestamp: string;
  interval: string;
  exchange: string;
  totalScanned: number;
  matches: FundingRateSignal[];
}

export interface FundingRateScanParams {
  symbols?: string;
  limit?: number;
  maxFundingRate?: number;
  exchange?: string;
  interval?: string;
}
