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

export interface IchimokuNearCloudBottomSignal {
  symbol: string;
  price: number;
  tenkan: number;
  kijun: number;
  spanA: number;
  spanB: number;
  cloudTop: number;
  cloudBottom: number;
  distanceToCloudBottomPct: number;
  position: 'ABOVE_CLOUD' | 'INSIDE_CLOUD' | 'BELOW_CLOUD';
  signal: 'NEAR_CLOUD_BOTTOM';
}

export interface IchimokuNearCloudBottomScanResult {
  timestamp: string;
  interval: string;
  exchange: string;
  thresholdPct: number;
  totalScanned: number;
  matches: IchimokuNearCloudBottomSignal[];
}

export interface IchimokuNearCloudBottomScanParams {
  symbols?: string;
  limit?: number;
  interval?: string;
  exchange?: string;
  thresholdPct?: number;
}
