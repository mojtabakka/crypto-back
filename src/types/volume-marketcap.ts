export interface LongSqueezeAssessment {
  level: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  score: number;
  reason: string;
}

export interface VolumeMarketCapMatch {
  id: string;
  symbol: string;
  name: string;
  image: string;
  price: number | null;
  marketCap: number;
  volume24h: number;
  ratio: number;
  marketCapRank: number | null;
  priceChange24h: number | null;
  circulatingSupply: number | null;
  longSqueeze?: LongSqueezeAssessment;
}

export interface VolumeMarketCapScanResult {
  timestamp: string;
  totalScanned: number;
  pagesFetched: number;
  criteria: {
    minRatio: number;
    minMarketCap: number;
  };
  matches: VolumeMarketCapMatch[];
}
