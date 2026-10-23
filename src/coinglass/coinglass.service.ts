import { Injectable, Logger } from '@nestjs/common';

export interface CoinGlassSymbolData {
  symbol: string;
  price: number;
  marketCap: number;
  openInterest: number;
  fundingRate: number;
  volume24h: number;
  liquidation24h: number;
  priceChange1h: number;
  priceChange24h: number;
  rsi1h: number | null;
  rsi4h: number | null;
  rsi1d: number | null;
}

export interface CoinGlassSignal {
  symbol: string;
  signal: 'HEALTHY_BULLISH' | 'STRONG_BULLISH' | 'LONG_PUMP' | 'NORMAL_CORRECTION' | 'LONG_FLUSH' | 'NEUTRAL';
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  score: number;
  data: CoinGlassSymbolData;
  reason: string;
}

export interface CoinGlassScanResult {
  longs: CoinGlassSignal[];
  shorts: CoinGlassSignal[];
  neutral: CoinGlassSignal[];
  totalScanned: number;
  fearGreedIndex: number | null;
  altcoinSeasonIndex: number | null;
  timestamp: string;
}

@Injectable()
export class CoinGlassService {
  private readonly logger = new Logger(CoinGlassService.name);
  private readonly apiKey: string | undefined;
  private readonly baseUrl = 'https://open-api.coinglass.com/api/pro/v1';

  constructor() {
    this.apiKey = process.env.COINGLASS_API_KEY;
  }

  private async fetch<T>(endpoint: string): Promise<T | null> {
    if (!this.apiKey) {
      this.logger.warn('COINGLASS_API_KEY is not set. Skipping CoinGlass data fetch.');
      return null;
    }

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        headers: {
          'accept': 'application/json',
          'coinglass.secretKey': this.apiKey,
        },
      });

      if (!response.ok) {
        this.logger.error(`CoinGlass API error: ${response.status} ${response.statusText} for ${endpoint}`);
        return null;
      }

      const data = await response.json();
      // Pro API wraps response in { code, data, message }
      return data?.data ?? data;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`CoinGlass fetch failed for ${endpoint}: ${msg}`);
      return null;
    }
  }

  async getGlobalIndices(): Promise<{ fearGreedIndex: number | null; altcoinSeasonIndex: number | null }> {
    const [fearGreed, altcoinSeason] = await Promise.all([
      this.fetch<{ data: { value: number } }>('/global/fear-greed-index'),
      this.fetch<{ data: { value: number } }>('/global/altcoin-season-index'),
    ]);

    return {
      fearGreedIndex: fearGreed?.data?.value ?? null,
      altcoinSeasonIndex: altcoinSeason?.data?.value ?? null,
    };
  }

  async getFuturesSymbols(limit = 200): Promise<CoinGlassSymbolData[]> {
    const data = await this.fetch<{ data: Array<{ symbol: string; price: number; marketCap: number; openInterest: number; fundingRate: number; volume24h: number; liquidation24h: number; priceChange1h: number; priceChange24h: number }> }>(`/futures/market-symbols?limit=${limit}`);

    if (!data?.data) return [];

    return data.data.map((item) => ({
      symbol: item.symbol,
      price: item.price ?? 0,
      marketCap: item.marketCap ?? 0,
      openInterest: item.openInterest ?? 0,
      fundingRate: item.fundingRate ?? 0,
      volume24h: item.volume24h ?? 0,
      liquidation24h: item.liquidation24h ?? 0,
      priceChange1h: item.priceChange1h ?? 0,
      priceChange24h: item.priceChange24h ?? 0,
      rsi1h: null,
      rsi4h: null,
      rsi1d: null,
    }));
  }

  private classifySignal(data: CoinGlassSymbolData): CoinGlassSignal | null {
    const { priceChange1h, priceChange24h, openInterest, fundingRate, volume24h } = data;

    // Thresholds
    const priceUp = priceChange1h > 0;
    const priceStrongUp = priceChange1h > 2;
    const priceDown = priceChange1h < 0;
    const priceStrongDown = priceChange1h < -2;

    const oiUp = openInterest > 0;
    const oiStrongUp = openInterest > 5;
    const oiDown = openInterest < 0;
    const oiStrongDown = openInterest < -5;

    const volUp = volume24h > 0;
    const volStrongUp = volume24h > 10;

    const fundingNeutral = fundingRate >= -0.01 && fundingRate <= 0.01;
    const fundingPositive = fundingRate > 0;
    const fundingStrongPositive = fundingRate > 0.05;
    const fundingNegative = fundingRate < 0;

    // HEALTHY_BULLISH: Price ↑ + OI ↑ + Volume ↑ + Funding →/↓
    if (
      priceUp && oiUp && volUp &&
      (fundingNeutral || fundingNegative)
    ) {
      return {
        symbol: data.symbol,
        signal: 'HEALTHY_BULLISH',
        direction: 'LONG',
        score: this.calculateScore(priceChange1h, openInterest, volume24h, fundingRate),
        data,
        reason: 'صعود سالم؛ پول و پوزیشن جدید وارد میشه ولی لانگ‌ها شلوغ نیستن',
      };
    }

    // STRONG_BULLISH: Price ↑↑ + OI ↑↑ + Volume ↑ + Funding ↑/→
    if (
      priceStrongUp && oiStrongUp && volUp &&
      (fundingPositive || fundingNeutral)
    ) {
      return {
        symbol: data.symbol,
        signal: 'STRONG_BULLISH',
        direction: 'LONG',
        score: this.calculateScore(priceChange1h, openInterest, volume24h, fundingRate) + 10,
        data,
        reason: 'روند صعودی قوی',
      };
    }

    // LONG_PUMP: Price ↑↑ + OI ↑↑ + Volume ↑↑ + Funding ↑↑
    if (
      priceStrongUp && oiStrongUp && volStrongUp && fundingStrongPositive
    ) {
      return {
        symbol: data.symbol,
        signal: 'LONG_PUMP',
        direction: 'LONG',
        score: this.calculateScore(priceChange1h, openInterest, volume24h, fundingRate) + 20,
        data,
        reason: 'پامپ همراه با ورود شدید پوزیشن‌ها؛ سودده ولی پرریسک',
      };
    }

    // NORMAL_CORRECTION: Price ↓ + OI ↓ + Volume ↓ + Funding ↓
    if (
      priceDown && oiDown && !volUp && fundingNegative
    ) {
      return {
        symbol: data.symbol,
        signal: 'NORMAL_CORRECTION',
        direction: 'SHORT',
        score: this.calculateScore(priceChange1h, openInterest, volume24h, fundingRate),
        data,
        reason: 'اصلاح طبیعی',
      };
    }

    // LONG_FLUSH: Price ↓↓ + OI ↓↓ + Volume ↑ + Funding ↓
    if (
      priceStrongDown && oiStrongDown && volUp && fundingNegative
    ) {
      return {
        symbol: data.symbol,
        signal: 'LONG_FLUSH',
        direction: 'SHORT',
        score: this.calculateScore(priceChange1h, openInterest, volume24h, fundingRate) + 15,
        data,
        reason: 'تخلیه لانگ‌ها',
      };
    }

    return null;
  }

  private calculateScore(priceChange1h: number, oiChange: number, volumeChange: number, fundingRate: number): number {
    let score = 0;
    score += Math.abs(priceChange1h) * 10;
    score += Math.abs(oiChange) * 5;
    score += Math.abs(volumeChange) * 2;
    score += Math.abs(fundingRate) * 100;
    return Math.round(score * 100) / 100;
  }

  async scanCoinGlassSignals(limit = 200): Promise<CoinGlassScanResult> {
    const startTime = Date.now();
    this.logger.log(`Starting CoinGlass signal scan for ${limit} symbols...`);

    const [symbolsData, globalIndices] = await Promise.all([
      this.getFuturesSymbols(limit),
      this.getGlobalIndices(),
    ]);

    const longs: CoinGlassSignal[] = [];
    const shorts: CoinGlassSignal[] = [];
    const neutral: CoinGlassSignal[] = [];

    for (const data of symbolsData) {
      const signal = this.classifySignal(data);
      if (!signal) {
        neutral.push({
          symbol: data.symbol,
          signal: 'NEUTRAL',
          direction: 'NEUTRAL',
          score: 0,
          data,
          reason: 'بدون سیگنال مشخص',
        });
        continue;
      }

      if (signal.direction === 'LONG') {
        longs.push(signal);
      } else if (signal.direction === 'SHORT') {
        shorts.push(signal);
      }
    }

    longs.sort((a, b) => b.score - a.score);
    shorts.sort((a, b) => b.score - a.score);

    const duration = Date.now() - startTime;
    this.logger.log(
      `CoinGlass scan complete: ${longs.length} longs, ${shorts.length} shorts in ${duration}ms`,
    );

    return {
      longs,
      shorts,
      neutral,
      totalScanned: symbolsData.length,
      fearGreedIndex: globalIndices.fearGreedIndex,
      altcoinSeasonIndex: globalIndices.altcoinSeasonIndex,
      timestamp: new Date().toISOString(),
    };
  }
}
