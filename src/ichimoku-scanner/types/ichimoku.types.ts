export interface IchimokuCandle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface IchimokuValues {
  tenkan: number;
  kijun: number;
  spanA: number;
  spanB: number;
  chikou: number;
}

export interface IchimokuConditions {
  priceAboveCloud: boolean;
  tenkanAboveKijun: boolean;
  chikouAbovePrice26: boolean;
  chikouClean: boolean;
  breakoutCandleClosed: boolean;
}

export interface IchimokuSignal {
  symbol: string;
  price: number;
  tenkan: number;
  kijun: number;
  spanA: number;
  spanB: number;
  chikou: number;
  signal: 'BUY' | 'NEUTRAL';
  conditions: IchimokuConditions;
  cloudTop: number;
  cloudBottom: number;
}

export interface IchimokuScanResult {
  timestamp: string;
  interval: string;
  exchange: string;
  totalScanned: number;
  matches: IchimokuSignal[];
}

export interface IchimokuScanParams {
  symbols?: string;
  limit?: number;
  interval?: string;
  exchange?: string;
}
