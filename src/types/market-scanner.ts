export interface SymbolSignal {
  symbol: string;
  score: number;
  signal: string;
  confidence: number;
  priceChange: number;
  oiChange: number;
  fundingRate: number;
  sma50: number | null;
  priceVsSma50: number | null;
  maSignal: 'ABOVE' | 'BELOW' | 'NEUTRAL';
}

export interface TrustedSignal extends SymbolSignal {
  trustScore: number;
  verified: boolean;
  trustBadges: string[];
}

export interface TrustedLongShortResult {
  longs: TrustedSignal[];
  shorts: TrustedSignal[];
  scanned: number;
  duration: number;
  timestamp: string;
}

export interface StrongSignalResult {
  longs: SymbolSignal[];
  shorts: SymbolSignal[];
  scanned: number;
  duration: number;
  timestamp: string;
}

export interface FakeSignalRisk {
  symbol: string;
  fakeSignalProbability: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  rsi: number | null;
  priceVsEma50: number | null;
  volumeRatio: number | null;
  momentum: number | null;
  direction: 'LONG' | 'SHORT';
}

export interface FakeSignalScanResult {
  risks: FakeSignalRisk[];
  scanned: number;
  duration: number;
  timestamp: string;
}

export interface FundingExtremeSymbol {
  symbol: string;
  fundingRate: number;
  priceChange: number;
  signal: string;
  direction: 'LONG_SQUEEZE' | 'SHORT_SQUEEZE' | 'NEUTRAL';
  target1: number;
  target2: number;
  target3: number;
}

export interface FundingExtremeResult {
  symbols: FundingExtremeSymbol[];
  scanned: number;
  duration: number;
  timestamp: string;
}

export interface DojiCandle {
  symbol: string;
  dojiType: 'BULLISH' | 'BEARISH';
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  bodySize: number;
  range: number;
  bodyRatio: number;
}

export interface DojiCandlesResult {
  candles: DojiCandle[];
  bullishCount: number;
  bearishCount: number;
  scanned: number;
  duration: number;
  timestamp: string;
}

export interface FundingVolumeSqueeze {
  symbol: string;
  fundingRate: number;
  fundingChange: number;
  volumeRatio: number;
  priceChange: number;
  isBullish: boolean;
  trustScore: number;
}

export interface FundingVolumeSqueezeResult {
  symbols: FundingVolumeSqueeze[];
  scanned: number;
  duration: number;
  timestamp: string;
}

export interface BTCCandle {
  date: string;
  close: number;
  value: number;
}

export interface BTCCandleResult {
  values: string[];
  raw: BTCCandle[];
}

export interface LiquidationDto {
  time: number;
  symbol: string;
  side: 'LONG' | 'SHORT';
  quantity: number;
  price: number;
  value: number;
}

export interface LiquidationCluster {
  symbol: string;
  side: 'LONG' | 'SHORT';
  priceCluster: number;
  priceRange: { min: number; max: number };
  totalValue: number;
  totalQuantity: number;
  liquidationCount: number;
  liquidations: LiquidationDto[];
}

export interface LiquidationClustersResult {
  exchange: string;
  clusters: LiquidationCluster[];
  scanned: number;
  duration: number;
  timestamp: string;
}
