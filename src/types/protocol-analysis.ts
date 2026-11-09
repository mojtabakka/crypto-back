export interface ProtocolSearchItem {
  slug: string;
  symbol: string;
  name: string;
  logo: string;
  category: string;
  tvl: number;
  change7d: number;
  chains: string[];
  chainCount: number;
  mcap: number | null;
}

export interface ProtocolIdentity {
  slug: string;
  name: string;
  symbol: string;
  logo: string;
  description: string;
  url: string;
  twitter: string | null;
  category: string;
  chains: string[];
  listedAt: number;
  ageInDays: number;
  geckoId: string | null;
  methodology: string | null;
}

export interface ProtocolTvlData {
  total: number;
  change1h: number | null;
  change1d: number | null;
  change7d: number | null;
  change1m: number | null;
  marketCap: number | null;
  fdv: number | null;
  mcapToTvl: number | null;
  tvlToMcap: number | null;
  chainBreakdown: { chain: string; tvl: number; sharePercent: number }[];
  history: { date: number; tvl: number }[];
  historyTrend: 'RISING' | 'FALLING' | 'FLAT';
}

export interface ProtocolRevenueData {
  fees24h: number | null;
  fees7d: number | null;
  fees30d: number | null;
  fees1y: number | null;
  revenue24h: number | null;
  revenue30d: number | null;
  revenue1y: number | null;
  feesChange1d: number | null;
  feesChange7d: number | null;
  annualizedRevenue30d: number | null;
  annualizedFees30d: number | null;
  history: { date: number; value: number }[];
  chainBreakdown: { chain: string; value: number; sharePercent: number }[];
  volume24h: number | null;
  volume7d: number | null;
  volume30d: number | null;
}

export interface ProtocolActivityData {
  stablecoinSupplyUsd: number | null;
  stablecoinSharePercent: number | null;
  dominantChain: string | null;
  feesToTvlPercent: number | null;
  volumeToTvlPercent: number | null;
  revenueMultiple: number | null;
  chainsCount: number;
  topChainSharePercent: number | null;
  activityScore: number;
}

export interface ProtocolTokenomics {
  marketCap: number | null;
  fdv: number | null;
  circulatingSupply: number | null;
  totalSupply: number | null;
  maxSupply: number | null;
  circulatingPercent: number | null;
  fdvToMcap: number | null;
  price: number | null;
  priceChange24h: number | null;
  priceChange7d: number | null;
  priceChange30d: number | null;
  priceChange1y: number | null;
  ath: number | null;
  athChangePercent: number | null;
  tokens: { symbol: string; name: string; decimals: number | null }[];
}

export interface ProtocolSecurity {
  audits: string | null;
  auditLinks: string[] | null;
  hacks: string[] | null;
  oracles: string[] | null;
  isAudited: boolean;
  hasHackHistory: boolean;
  hackLossUsd: number;
  hackLossToTvlPercent: number;
  latestHackDate: number | null;
  securityScore: number;
}

export interface ProtocolValuation {
  mcapToTvl: number | null;
  tvlToRevenueAnnualized: number | null;
  feesToMcap: number | null;
  labels: { label: string; value: string; tone: 'GOOD' | 'NEUTRAL' | 'BAD' }[];
}

export interface ProtocolHealthScore {
  total: number;
  tvlStrength: number;
  growth: number;
  revenueQuality: number;
  activity: number;
  valuation: number;
  security: number;
  tokenomics: number;
  verdict: 'STRONG_BUY' | 'ACCUMULATE' | 'HOLD' | 'CAUTION' | 'AVOID';
  summary: string;
}

export interface ProtocolDeepDive {
  identity: ProtocolIdentity;
  tvl: ProtocolTvlData;
  revenue: ProtocolRevenueData;
  activity: ProtocolActivityData;
  tokenomics: ProtocolTokenomics;
  security: ProtocolSecurity;
  valuation: ProtocolValuation;
  healthScore: ProtocolHealthScore;
  warnings: string[];
  timestamp: string;
}
