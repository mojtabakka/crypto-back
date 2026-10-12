import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import type {
  TokenomicsData,
  TokenUnlock,
  TechnicalData,
  OnChainData,
  MarketStructureData,
} from './types/tvl-validation.types';

@Injectable()
export class TVLValidationDataService {
  private readonly logger = new Logger(TVLValidationDataService.name);
  private readonly COINGECKO_BASE = 'https://api.coingecko.com/api/v3';
  private readonly DEFILLAMA_BASE = 'https://api.llama.fi';
  private readonly TOKEN_UNLOCKS_BASE = 'https://api.token.unlocks.app'; // placeholder

  constructor(private readonly httpService: HttpService) {}

  // ============ TOKENOMICS ============
  async fetchTokenomics(
    symbol: string,
    coingeckoId: string | null,
  ): Promise<TokenomicsData | null> {
    if (!coingeckoId) return null;

    try {
      const [coinData, unlocksData] = await Promise.all([
        this.fetchCoingeckoCoin(coingeckoId),
        this.fetchTokenUnlocks(symbol).catch(() => null),
      ]);

      if (!coinData) return null;

      const marketCap = coinData.market_data?.market_cap?.usd || 0;
      const fdv =
        coinData.market_data?.fully_diluted_valuation?.usd || marketCap;
      const circulatingSupply = coinData.market_data?.circulating_supply || 0;
      const totalSupply =
        coinData.market_data?.total_supply || circulatingSupply;
      const maxSupply = coinData.market_data?.max_supply || null;

      const fdvToMcapRatio = marketCap > 0 ? fdv / marketCap : 999;
      const circulatingPercent =
        totalSupply > 0 ? (circulatingSupply / totalSupply) * 100 : 0;

      // Check if protocol has revenue sharing (simplified - would need per-protocol logic)
      const revenueShare = this.checkRevenueShare(coingeckoId, coinData);

      return {
        fdv,
        marketCap,
        circulatingSupply,
        totalSupply,
        maxSupply,
        fdvToMcapRatio,
        circulatingPercent,
        upcomingUnlocks: unlocksData || [],
        revenueShare,
        revenueSharePercent: revenueShare ? 10 : null, // placeholder
      };
    } catch (error) {
      this.logger.warn(`Failed to fetch tokenomics for ${symbol}: ${error}`);
      return null;
    }
  }

  private async fetchCoingeckoCoin(id: string): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.COINGECKO_BASE}/coins/${id}`, {
          params: {
            localization: false,
            tickers: false,
            community_data: false,
            developer_data: false,
          },
          timeout: 10000,
        }),
      );
      return response.data;
    } catch {
      return null;
    }
  }

  private async fetchTokenUnlocks(symbol: string): Promise<TokenUnlock[]> {
    // Placeholder - would integrate with token.unlocks.app or similar
    // For now, return mock data structure
    return [];
  }

  private checkRevenueShare(coingeckoId: string, coinData: any): boolean {
    // Simplified heuristic - protocols with fee revenue sharing
    const revenueProtocols = [
      'uniswap',
      'aave',
      'compound',
      'maker',
      'curve',
      'balancer',
      'lido',
      'rocket-pool',
      'frax',
      'gmx',
      'synthetix',
      'convex',
      'pendle',
      'aerodrome',
      'velodrome',
      'ram',
      'morpho',
    ];
    return revenueProtocols.includes(coingeckoId.toLowerCase());
  }

  // ============ TECHNICAL ============
  async fetchTechnical(
    symbol: string,
    exchange: string = 'BINANCE',
  ): Promise<TechnicalData | null> {
    try {
      // This would call your existing market-signal service
      // For now, return structure with placeholders
      return {
        trend: 'NEUTRAL',
        ema50: 0,
        ema200: 0,
        priceVsEma50: 0,
        priceVsEma200: 0,
        rsi: 50,
        volume24h: 0,
        volumeChange7d: 0,
        higherHighs: false,
        higherLows: false,
        structureScore: 5,
      };
    } catch {
      return null;
    }
  }

  // ============ ON-CHAIN ============
  async fetchOnChainData(
    slug: string,
    chain: string,
    category: string,
  ): Promise<OnChainData | null> {
    try {
      const [summary, protocolData] = await Promise.all([
        this.fetchDefiLlamaSummary(),
        this.fetchProtocolDetail(slug),
      ]);

      if (!protocolData) return null;

      const fees24h = protocolData.total24h || 0;
      const fees7d = protocolData.total7d || 0;
      const fees30d = protocolData.total30d || 0;
      const revenue24h = protocolData.revenue24h || fees24h * 0.1; // estimate
      const revenue7d = protocolData.revenue7d || fees7d * 0.1;
      const revenue30d = protocolData.revenue30d || fees30d * 0.1;

      const stablecoinTvl = this.estimateStablecoinTvl(
        chain,
        category,
        protocolData.tvl || 0,
      );
      const tvlToRevenueRatio =
        revenue30d > 0 ? (protocolData.tvl || 0) / (revenue30d * 12) : null; // annualized

      return {
        fees24h,
        fees7d,
        fees30d,
        revenue24h,
        revenue7d,
        revenue30d,
        dailyActiveUsers: this.estimateUsers(category, fees24h),
        weeklyActiveUsers: this.estimateUsers(category, fees7d),
        stablecoinTvlPercent: stablecoinTvl,
        tvlToRevenueRatio,
      };
    } catch {
      return null;
    }
  }

  private async fetchDefiLlamaSummary(): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.DEFILLAMA_BASE}/summary/fees`, {
          timeout: 10000,
        }),
      );
      return response.data;
    } catch {
      return null;
    }
  }

  private async fetchProtocolDetail(slug: string): Promise<any> {
    try {
      const response = await firstValueFrom(
        this.httpService.get(`${this.DEFILLAMA_BASE}/protocol/${slug}`, {
          timeout: 10000,
        }),
      );
      return response.data;
    } catch {
      return null;
    }
  }

  private estimateStablecoinTvl(
    chain: string,
    category: string,
    tvl: number,
  ): number {
    if (category === 'Stablecoins') return 100;
    if (category === 'Lending') return 40;
    if (category === 'Dexes') return 15;
    if (chain === 'Ethereum') return 20;
    return 10;
  }

  private estimateUsers(category: string, fees: number): number {
    const feePerUser =
      category === 'Dexes' ? 50 : category === 'Lending' ? 200 : 100;
    return Math.max(100, fees / feePerUser);
  }

  // ============ MARKET STRUCTURE ============
  async fetchMarketStructure(
    symbol: string,
  ): Promise<MarketStructureData | null> {
    // Would integrate with your exchange service for order book, funding, OI
    return {
      topExchangeListings: ['BINANCE'],
      hasTier1Listing: true,
      orderBookDepth2Percent: 500000,
      fundingRate: 0,
      oiChange24h: 0,
      oiTrend: 'FLAT',
      liquidityScore: 7,
    };
  }
}
