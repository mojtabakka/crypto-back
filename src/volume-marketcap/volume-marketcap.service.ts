import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { RedisService } from '../redis/redis.service';
import { BinanceService } from 'src/binance/binance.service';
import { BybitService } from 'src/bybit/bybit.service';
import type {
  VolumeMarketCapMatch,
  VolumeMarketCapScanResult,
  LongSqueezeAssessment,
} from './types/volume-marketcap.types';

const BINANCE_FAPI = 'https://fapi.binance.com';

interface BinancePremiumIndex {
  symbol: string;
  markPrice: string;
  lastFundingRate: string;
}

interface BinanceOpenInterest {
  symbol: string;
  openInterest: string;
}

export type SupportedExchange = 'binance' | 'bybit' | 'mexc' | 'toobit';

@Injectable()
export class VolumeMarketCapService {
  private readonly logger = new Logger(VolumeMarketCapService.name);

  private readonly COIN_MARKET_CACHE_KEY = 'vmc:coin-market-map';
  private readonly COIN_MARKET_CACHE_TTL = 60 * 60; // 1 hour

  constructor(
    private readonly httpService: HttpService,
    private readonly redisService: RedisService,
    private readonly binanceService: BinanceService,
    private readonly bybitService: BybitService,
  ) {}

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

    for (let page = 1; page <= pages; page++) {
      const tickers = await this.bybitService.getTickers();
      if (!tickers || tickers.length === 0) break;

      totalScanned += tickers.length;

      for (const ticker of tickers) {
        const symbol = ticker.symbol.replace('USDT', '');
        const vol = Number(ticker.volume24h) || 0;

        if (vol === 0) continue;

        const match: VolumeMarketCapMatch = {
          id: symbol,
          symbol,
          name: symbol,
          image: '',
          price: Number(ticker.lastPrice) || null,
          marketCap: 0,
          volume24h: vol,
          ratio: 0,
          marketCapRank: null,
          priceChange24h: null,
          circulatingSupply: null,
        };

        if (includeSqueeze) {
          match.longSqueeze = await this.assessLongSqueeze(symbol, 0, vol);
        }

        allMatches.push(match);

        if (allMatches.length >= limit) break;
      }

      if (allMatches.length >= limit) break;
    }

    allMatches.sort((a, b) => b.volume24h - a.volume24h);

    return {
      timestamp: new Date().toISOString(),
      totalScanned,
      pagesFetched: 1,
      criteria: { minRatio, minMarketCap },
      matches: allMatches,
    };
  }

  async getCoinMarketMap(
    exchange: SupportedExchange = 'binance',
  ): Promise<Map<string, { marketCap: number; volume24h: number }>> {
    const cacheKey = `${this.COIN_MARKET_CACHE_KEY}:${exchange}`;

    const cached =
      await this.redisService.getJson<
        Record<string, { marketCap: number; volume24h: number }>
      >(cacheKey);
    if (cached) {
      return new Map(Object.entries(cached));
    }

    const map = new Map<string, { marketCap: number; volume24h: number }>();

    if (exchange === 'binance') {
      const tickers = await this.binanceService.getTickers();
      for (const ticker of tickers) {
        const symbol = ticker.symbol.replace('USDT', '');
        map.set(symbol, {
          marketCap: 0,
          volume24h: Number(ticker.volume) || 0,
        });
      }
    } else if (exchange === 'bybit') {
      const tickers = await this.bybitService.getTickers();
      for (const ticker of tickers) {
        const symbol = ticker.symbol.replace('USDT', '');
        map.set(symbol, {
          marketCap: 0,
          volume24h: Number(ticker.volume24h) || 0,
        });
      }
    }

    try {
      await this.redisService.setJson(
        cacheKey,
        Object.fromEntries(map),
        this.COIN_MARKET_CACHE_TTL,
      );
    } catch {
      // ignore cache write errors
    }

    return map;
  }
}
