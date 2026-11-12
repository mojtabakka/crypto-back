export interface IchimokuBullishConditionResult {
  priceAboveCloud: boolean;
  chikouAbovePrice26: boolean;
  tenkanAboveKijun: boolean;
  cloudGreen: boolean;
  volumeIncreased: boolean;
  pullbackSupported: boolean;
  hhLhStructure: boolean;
}

export interface IchimokuBullishSignal {
  symbol: string;
  price: number;
  tenkan: number;
  kijun: number;
  spanA: number;
  spanB: number;
  cloudTop: number;
  cloudBottom: number;
  chikouValue: number;
  chikouPrice26Ago: number;
  volume: number;
  avgVolume: number;
  volumeRatio: number;
  hhLhStructure: boolean;
  conditions: IchimokuBullishConditionResult;
  score: number;
  signal: 'BULLISH' | 'NEUTRAL';
}

export interface IchimokuBullishScanResult {
  timestamp: string;
  interval: string;
  exchange: string;
  totalScanned: number;
  matches: IchimokuBullishSignal[];
}

export interface IchimokuBullishScanParams {
  symbols?: string;
  limit?: number;
  interval?: string;
  exchange?: string;
  lookbackBars?: number;
  minVolumeRatio?: number;
}
