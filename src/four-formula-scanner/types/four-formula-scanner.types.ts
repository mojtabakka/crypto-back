export interface FourFormulaSignal {
  symbol: string;
  signal: 'LONG' | 'STRONG_LONG' | 'SHORT' | 'STRONG_SHORT' | 'NEUTRAL';
  score: number;
  confidence: number;
  priceChange: number;
  oiChange: number;
  volumeRatio: number;
  fundingRate: number;
}

export interface FourFormulaScanResult {
  timestamp: string;
  interval: string;
  exchange: string;
  totalScanned: number;
  analyzed: number;
  matches: FourFormulaSignal[];
}

export interface FourFormulaScanParams {
  symbols?: string;
  limit?: number;
  exchange?: string;
  direction?: 'LONG' | 'SHORT' | 'ALL';
  minScore?: number;
}
