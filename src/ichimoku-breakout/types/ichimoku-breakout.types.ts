export interface IchimokuBreakoutSignal {
  symbol: string;
  price: number;
  tenkan: number;
  kijun: number;
  spanA: number;
  spanB: number;
  cloudTop: number;
  cloudBottom: number;
  priceChangePct: number;
  volumeChangePct: number;
  daysAboveCloud: number;
  breakoutDate: string | null;
  monthlyBreakout: boolean;
  weeklyBreakout: boolean;
  dailyBreakout: boolean;
  score: number;
  volumeRatio: number;
  marketCap: number;
  volume24h: number;
  signal: 'BUY';
}

export interface IchimokuBreakoutScanResult {
  timestamp: string;
  interval: string;
  exchange: string;
  totalScanned: number;
  matches: IchimokuBreakoutSignal[];
}

export interface IchimokuBreakoutScanParams {
  symbols?: string;
  limit?: number;
  interval?: string;
  exchange?: string;
}
