export interface IchimokuBaseConversionSignal {
  symbol: string;
  price: number;
  tenkanValue: number;
  touchPoint: number;
  signal: 'BUY' | 'SELL';
}

export interface IchimokuBaseConversionScanResult {
  timestamp: string;
  interval: string;
  exchange: string;
  totalScanned: number;
  matches: IchimokuBaseConversionSignal[];
}

export interface IchimokuBaseConversionScanParams {
  symbols?: string;
  limit?: number;
  interval?: string;
  exchange?: string;
}
