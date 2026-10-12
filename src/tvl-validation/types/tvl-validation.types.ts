export interface TokenomicsData {
  fdv: number;
  marketCap: number;
  circulatingSupply: number;
  totalSupply: number;
  maxSupply: number | null;
  fdvToMcapRatio: number;
  circulatingPercent: number;
  upcomingUnlocks: TokenUnlock[];
  revenueShare: boolean;
  revenueSharePercent: number | null;
}

export interface TokenUnlock {
  date: number;
  amount: number;
  percentOfSupply: number;
  type: 'team' | 'investor' | 'ecosystem' | 'staking' | 'other';
}

export interface TechnicalData {
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  ema50: number;
  ema200: number;
  priceVsEma50: number;
  priceVsEma200: number;
  rsi: number;
  volume24h: number;
  volumeChange7d: number;
  higherHighs: boolean;
  higherLows: boolean;
  structureScore: number; // 0-10
}

export interface OnChainData {
  fees24h: number;
  fees7d: number;
  fees30d: number;
  revenue24h: number;
  revenue7d: number;
  revenue30d: number;
  dailyActiveUsers: number;
  weeklyActiveUsers: number;
  stablecoinTvlPercent: number;
  tvlToRevenueRatio: number | null; // P/E equivalent
}

export interface MarketStructureData {
  topExchangeListings: string[];
  hasTier1Listing: boolean;
  orderBookDepth2Percent: number;
  fundingRate: number;
  oiChange24h: number;
  oiTrend: 'UP' | 'DOWN' | 'FLAT';
  liquidityScore: number; // 0-10
}

export interface RiskFlags {
  tvlDecline7d: boolean;
  overvaluedMcapTvl: boolean;
  largeUnlockSoon: boolean;
  recentExploit: boolean;
  regulatoryAction: boolean;
  lowLiquidity: boolean;
  flagCount: number;
  flags: string[];
}

export interface ValidationScore {
  tvlFundamental: number; // 0-10 (25% weight)
  tokenomics: number; // 0-10 (20% weight)
  technical: number; // 0-10 (20% weight)
  onChain: number; // 0-10 (15% weight)
  marketStructure: number; // 0-10 (10% weight)
  narrative: number; // 0-10 (10% weight)
  totalScore: number; // 0-10 weighted
  recommendation: 'FULL' | 'HALF' | 'WATCH' | 'AVOID';
  positionSizePercent: number; // % of portfolio
}

export interface ProtocolValidationResult {
  symbol: string;
  name: string;
  tvlAnalysis: {
    tvlScore: number;
    tvl: number;
    change7d: number;
    mcapToTvlRatio: number | null;
  };
  tokenomics: TokenomicsData | null;
  technical: TechnicalData | null;
  onChain: OnChainData | null;
  marketStructure: MarketStructureData | null;
  riskFlags: RiskFlags;
  validationScore: ValidationScore;
  timestamp: string;
}

export interface ValidationConfig {
  minTvlScore: number;
  minGrowth7d: number;
  maxMcapTvlRatio: number;
  minScoreForFull: number;
  minScoreForHalf: number;
  maxPositionFull: number;
  maxPositionHalf: number;
}
