export interface DefiLlamaProtocol {
  id: string;
  name: string;
  address: string;
  symbol: string;
  url: string;
  description: string;
  chain: string;
  logo: string;
  audits: string;
  audit_note: string | null;
  audit_links: string[] | null;
  gecko_id: string | null;
  cmcId: string | null;
  category: string;
  chains: string[];
  module: string;
  twitter: string | null;
  forkedFrom: string[] | null;
  oracles: string[] | null;
  listedAt: number;
  methodology: string;
  slug: string;
  tvl: number;
  change_1h: number;
  change_1d: number;
  change_7d: number;
  chainTvls: Record<string, number>;
  mcap?: number;
  fdv?: number;
  mcapRank?: number;
}

export interface TVLAnalysisResult {
  protocol: DefiLlamaProtocol;
  tvlScore: number;
  mcapToTvlRatio: number | null;
  category: string;
  chain: string;
  signals: TVLSignal[];
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
