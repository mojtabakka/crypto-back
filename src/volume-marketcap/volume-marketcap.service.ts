import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { RedisService } from '../redis/redis.service';
import type {
  VolumeMarketCapMatch,
  VolumeMarketCapScanResult,
  LongSqueezeAssessment,
  CoinGeckoMarketCoin,
} from './types/volume-marketcap.types';

const COINGECKO = 'https://api.coingecko.com/api/v3';
const BINANCE_FAPI = 'https://fapi.binance.com';
const PER_PAGE = 250;

interface BinancePremiumIndex {
  symbol: string;
  markPrice: string;
  lastFundingRate: string;
}

interface BinanceOpenInterest {
  symbol: string;
  openInterest: string;
}

@Injectable()
export class VolumeMarketCapService {
  private readonly logger = new Logger(VolumeMarketCapService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly redisService: RedisService,
  ) {}

  private async fetchCoingeckoPage(
    page: number,
  ): Promise<CoinGeckoMarketCoin[]> {
    const response = await firstValueFrom(
      this.httpService.get<CoinGeckoMarketCoin[]>(
        `${COINGECKO}/coins/markets`,
        {
          params: {
            vs_currency: 'usd',
            order: 'market_cap_desc',
            per_page: PER_PAGE,
            page,
            sparkline: false,
          },
          timeout: 15000,
        },
      ),
    );
    return response.data ?? [];
  }

  private async resolveBinanceSymbol(symbol: string): Promise<string | null> {
    const usdtSymbol = `${symbol.toUpperCase()}USDT`;
    try {
      const response = await firstValueFrom(
        this.httpService.get<BinancePremiumIndex>(
          `${BINANCE_FAPI}/fapi/v1/premiumIndex`,
          { params: { symbol: usdtSymbol }, timeout: 5000 },
        ),
      );
      if (response.data?.symbol) return usdtSymbol;
    } catch {
      // symbol may not exist on Binance futures
    }
    return null;
  }

  private async assessLongSqueeze(
    symbol: string,
    marketCap: number,
    volume24h: number,
    binanceSymbol?: string,
  ): Promise<LongSqueezeAssessment> {
    const cacheKey = `vmc:squeeze:${symbol.toUpperCase()}`;
    const cached = await this.redisService.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached) as LongSqueezeAssessment;
      } catch {
        // ignore parse errors, refetch
      }
    }

    const resolved = binanceSymbol ?? (await this.resolveBinanceSymbol(symbol));
    if (!resolved) {
      const result: LongSqueezeAssessment = {
        level: 'UNKNOWN',
        score: 0,
        reason: 'No Binance futures data',
      };
      await this.redisService.set(cacheKey, JSON.stringify(result), 300);
      return result;
    }

    let fundingRate = 0;
    let openInterest = 0;

    try {
      const premium = await firstValueFrom(
        this.httpService.get<BinancePremiumIndex>(
          `${BINANCE_FAPI}/fapi/v1/premiumIndex`,
          { params: { symbol: resolved }, timeout: 5000 },
        ),
      );
      fundingRate = parseFloat(premium.data.lastFundingRate) || 0;
    } catch {
      fundingRate = 0;
    }

    try {
      const oi = await firstValueFrom(
        this.httpService.get<BinanceOpenInterest>(
          `${BINANCE_FAPI}/fapi/v1/openInterest`,
          { params: { symbol: resolved }, timeout: 5000 },
        ),
      );
      openInterest = parseFloat(oi.data.openInterest) || 0;
    } catch {
      openInterest = 0;
    }

    const oiToMcap = marketCap > 0 ? openInterest / marketCap : 0;
    const volToMcap = marketCap > 0 ? volume24h / marketCap : 0;
    const fundingPct = fundingRate * 100;

    let level: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN' = 'UNKNOWN';
    let score = 0;
    const reasons: string[] = [];

    if (fundingPct > 0.01) {
      score += 30;
      reasons.push(`Funding ${fundingPct.toFixed(3)}% (bullish)`);
    } else if (fundingPct < -0.01) {
      score -= 20;
      reasons.push(`Funding ${fundingPct.toFixed(3)}% (bearish)`);
    }

    if (oiToMcap > 0.5) {
      score += 25;
      reasons.push(`OI/MCap ${(oiToMcap * 100).toFixed(1)}%`);
    } else if (oiToMcap > 0.2) {
      score += 10;
      reasons.push(`OI/MCap ${(oiToMcap * 100).toFixed(1)}%`);
    }

    if (volToMcap > 1) {
      score += 25;
      reasons.push(`Vol/MCap ${volToMcap.toFixed(2)}x`);
    } else if (volToMcap > 0.5) {
      score += 10;
      reasons.push(`Vol/MCap ${volToMcap.toFixed(2)}x`);
    }

    if (score >= 50) level = 'HIGH';
    else if (score >= 25) level = 'MEDIUM';
    else if (score >= 0) level = 'LOW';

    const result: LongSqueezeAssessment = {
      level,
      score,
      reason: reasons.length ? reasons.join(', ') : 'Neutral conditions',
    };

    await this.redisService.set(cacheKey, JSON.stringify(result), 300);
    return result;
  }

  async scan(
    minRatio: number,
    minMarketCap: number,
    limit: number,
    pages: number,
    forceRefresh: boolean,
    includeSqueeze: boolean,
  ): Promise<VolumeMarketCapScanResult> {
    const allMatches: VolumeMarketCapMatch[] = [];
    let totalScanned = 0;
    let pagesFetched = 0;

    for (let page = 1; page <= pages; page++) {
      const coins = await this.fetchCoingeckoPage(page);
      if (!coins || coins.length === 0) break;

      pagesFetched++;
      totalScanned += coins.length;

      for (const coin of coins) {
        const mc = coin.market_cap ?? 0;
        const vol = coin.total_volume ?? 0;

        if (mc < minMarketCap) continue;
        if (mc === 0) continue;

        const ratio = vol / mc;
        if (ratio < minRatio) continue;

        // Only include coins that trade on Binance futures
        const binanceSymbol = await this.resolveBinanceSymbol(coin.symbol);
        if (!binanceSymbol) continue;

        const match: VolumeMarketCapMatch = {
          id: coin.id,
          symbol: coin.symbol.toUpperCase(),
          name: coin.name,
          image: coin.image,
          price: coin.current_price ?? null,
          marketCap: mc,
          volume24h: vol,
          ratio,
          marketCapRank: coin.market_cap_rank ?? null,
          priceChange24h: coin.price_change_percentage_24h ?? null,
          circulatingSupply: coin.circulating_supply ?? null,
        };

        if (includeSqueeze) {
          match.longSqueeze = await this.assessLongSqueeze(
            coin.symbol,
            mc,
            vol,
            binanceSymbol,
          );
        }

        allMatches.push(match);

        if (allMatches.length >= limit) break;
      }

      if (allMatches.length >= limit) break;
    }

    allMatches.sort((a, b) => b.ratio - a.ratio);

    return {
      timestamp: new Date().toISOString(),
      totalScanned,
      pagesFetched,
      criteria: { minRatio, minMarketCap },
      matches: allMatches,
    };
  }
}
