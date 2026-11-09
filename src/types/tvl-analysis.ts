export interface TVLProtocol {
  id: string;
  name: string;
  symbol: string;
  url: string;
  description: string;
  chain: string;
  logo: string;
  category: string;
  chains: string[];
  tvl: number;
  change_1h: number;
  change_1d: number;
  change_7d: number;
  chainTvls: Record<string, number>;
  mcap?: number;
  fdv?: number;
  mcapRank?: number;
  listedAt: number;
}

export interface TVLSignal {
  type:
    | 'HIGH_TVL'
    | 'GROWING_TVL'
    | 'LOW_MCAP_TVL_RATIO'
    | 'STABLE_TVL'
    | 'MULTI_CHAIN'
    | 'BLUE_CHIP';
  strength: 'STRONG' | 'MODERATE' | 'WEAK';
  description: string;
}

export interface TVLAnalysisResult {
  protocol: TVLProtocol;
  tvlScore: number;
  mcapToTvlRatio: number | null;
  category: string;
  chain: string;
  signals: TVLSignal[];
}

export interface TVLScanResult {
  totalProtocols: number;
  analyzed: number;
  allAnalyzed: TVLAnalysisResult[];
  topByTVL: TVLAnalysisResult[];
  topByGrowth: TVLAnalysisResult[];
  undervalued: TVLAnalysisResult[];
  blueChips: TVLAnalysisResult[];
  multiChain: TVLAnalysisResult[];
  timestamp: string;
}
