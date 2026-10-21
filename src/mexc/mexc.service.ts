import { Injectable, Logger } from '@nestjs/common';

import axios from 'axios';

import { BinanceKline } from 'src/market/dto/binance-kline.type';
import { BinanceFundingRate } from 'src/market/types/binance-funding-rate.type';
import { BinanceLiquidationOrder } from 'src/market/types/binance-liquidation.type';
import { BinanceOpenInterest } from 'src/market/types/binance-open-interest.type';

import { RedisService } from 'src/redis/redis.service';

@Injectable()
export class MexcService {
  private readonly logger = new Logger(MexcService.name);

  private readonly FUNDING_CACHE_TTL = 7 * 24 * 60 * 60;
  private readonly KLINES_CACHE_TTL = 5 * 60;
  private readonly OI_CACHE_TTL = 5 * 60;

  private readonly baseUrl = 'https://contract.mexc.com';

  constructor(private readonly redisService: RedisService) {}

  // Convert Binance-style symbol (BTCUSDT) to MEXC contract symbol (BTC_USDT).
  private toMexcSymbol(symbol: string): string {
    const s = symbol.toUpperCase();
    if (s.includes('_')) return s;
    // Handle common quote assets.
    for (const quote of ['USDT', 'USDC', 'USD']) {
      if (s.endsWith(quote)) {
        return `${s.slice(0, -quote.length)}_${quote}`;
      }
    }
    return s;
  }

  private mapInterval(interval: string): string {
    const map: Record<string, string> = {
      '1m': 'Min1',
      '5m': 'Min5',
      '15m': 'Min15',
      '30m': 'Min30',
      '1h': 'Min60',
      '4h': 'Hour4',
      '8h': 'Hour8',
      '1d': 'Day1',
      '1w': 'Week1',
      '1M': 'Month1',
    };
    return map[interval] || 'Min15';
  }

  async getKlines(
    symbol: string,
    interval: string,
    startTime: number,
    endTime: number,
    limit = 1000,
  ): Promise<BinanceKline[]> {
    return this.getFuturesKlines(symbol, interval, startTime, endTime, limit);
  }

  async getFuturesKlines(
    symbol: string,
    interval: string,
    startTime: number,
    endTime: number,
    limit = 1000,
  ): Promise<BinanceKline[]> {
    const cacheKey = `mexc:klines:${symbol}:${interval}:${startTime}:${endTime}`;
    const cached = await this.redisService.getJson<BinanceKline[]>(cacheKey);
    if (cached && cached.length > 0) return cached;

    const allKlines: BinanceKline[] = [];
    const mexcSymbol = this.toMexcSymbol(symbol);
    const mexcInterval = this.mapInterval(interval);

    // MEXC uses seconds for start/end.
    const startSec = Math.floor(startTime / 1000);
    const endSec = Math.floor(endTime / 1000);

    try {
      const response = await axios.get(`${this.baseUrl}/api/v1/contract/kline/${mexcSymbol}`, {
        params: {
          interval: mexcInterval,
          start: startSec,
          end: endSec,
        },
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 15000,
      });

      const data = response.data?.data;
      if (data && Array.isArray(data.time)) {
        const times: number[] = data.time;
        const opens: number[] = data.open;
        const highs: number[] = data.high;
        const lows: number[] = data.low;
        const closes: number[] = data.close;
        const vols: number[] = data.vol;

        for (let i = 0; i < times.length; i++) {
          const openTime = times[i] * 1000;
          const closeTime = openTime + this.intervalMs(interval);
          allKlines.push([
            openTime,
            String(opens[i]),
            String(highs[i]),
            String(lows[i]),
            String(closes[i]),
            String(vols[i] ?? 0),
            closeTime,
            String((vols[i] ?? 0) * (closes[i] ?? 0)),
            0,
            '0',
            '0',
            '0',
          ]);
        }
      }
    } catch (error) {
      this.logger.warn(`MEXC klines fetch failed for ${symbol}: ${error}`);
    }

    if (allKlines.length > 0) {
      await this.redisService.setJson(cacheKey, allKlines, this.KLINES_CACHE_TTL);
    }
    return allKlines;
  }

  async getOpenInterest(
    symbol: string,
    startTime: number,
    endTime: number,
  ): Promise<BinanceOpenInterest[]> {
    const cacheKey = `mexc:oi:${symbol}:${startTime}:${endTime}`;
    const cached = await this.redisService.getJson<BinanceOpenInterest[]>(cacheKey);
    if (cached && cached.length > 0) return cached;

    // MEXC has no OI history endpoint; use current holdVol from ticker as a single point.
    const mexcSymbol = this.toMexcSymbol(symbol);
    const result: BinanceOpenInterest[] = [];
    try {
      const response = await axios.get(`${this.baseUrl}/api/v1/contract/ticker`, {
        params: { symbol: mexcSymbol },
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000,
      });
      const data = response.data?.data;
      if (data && data.holdVol !== undefined) {
        result.push({
          symbol,
          sumOpenInterest: String(data.holdVol),
          sumOpenInterestValue: '0',
          timestamp: data.timestamp || Date.now(),
        });
      }
    } catch (error) {
      this.logger.warn(`MEXC open interest fetch failed for ${symbol}: ${error}`);
    }

    await this.redisService.setJson(cacheKey, result, this.OI_CACHE_TTL);
    return result;
  }

  async getFundingRate(
    symbol: string,
    startTime: number,
    endTime: number,
  ): Promise<BinanceFundingRate[]> {
    const mexcSymbol = this.toMexcSymbol(symbol);
    const apiData: BinanceFundingRate[] = [];

    try {
      const response = await axios.get(`${this.baseUrl}/api/v1/contract/funding_rate/${mexcSymbol}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000,
      });
      const data = response.data?.data;
      if (data && data.fundingRate !== undefined) {
        const rate: BinanceFundingRate = {
          symbol,
          fundingRate: String(data.fundingRate),
          fundingTime: data.timestamp || Date.now(),
        };
        apiData.push(rate);
        await this.redisService.setJson(
          `mexc:funding:${symbol}:${rate.fundingTime}`,
          rate,
          this.FUNDING_CACHE_TTL,
        );
      }
    } catch (error) {
      this.logger.warn(`MEXC funding rate fetch failed for ${symbol}: ${error}`);
    }

    // Supplement with cached history.
    const redisData: BinanceFundingRate[] = [];
    const step = 8 * 60 * 60 * 1000;
    for (let t = startTime; t <= endTime; t += step) {
      const cached = await this.redisService.getJson<BinanceFundingRate>(`mexc:funding:${symbol}:${t}`);
      if (cached) redisData.push(cached);
    }

    const merged = new Map<number, BinanceFundingRate>();
    for (const item of apiData) merged.set(item.fundingTime, item);
    for (const item of redisData) {
      if (!merged.has(item.fundingTime)) merged.set(item.fundingTime, item);
    }

    // Also try funding rate history endpoint.
    try {
      const histResp = await axios.get(`${this.baseUrl}/api/v1/contract/funding_rate/history`, {
        params: { symbol: mexcSymbol, page_num: 1, page_size: 100 },
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000,
      });
      const list = histResp.data?.data?.resultList ?? [];
      for (const item of list) {
        const fr: BinanceFundingRate = {
          symbol,
          fundingRate: String(item.fundingRate ?? item.rate ?? 0),
          fundingTime: Number(item.settleTime ?? item.timestamp ?? Date.now()),
        };
        if (!merged.has(fr.fundingTime)) merged.set(fr.fundingTime, fr);
      }
    } catch (error) {
      this.logger.debug(`MEXC funding history fetch failed for ${symbol}: ${error}`);
    }

    return Array.from(merged.values()).sort((a, b) => a.fundingTime - b.fundingTime);
  }

  async getLiquidationOrders(
    symbol: string,
    startTime: number,
    endTime: number,
  ): Promise<BinanceLiquidationOrder[]> {
    // MEXC does not expose a public liquidation-orders endpoint.
    return [];
  }

  private intervalMs(interval: string): number {
    const map: Record<string, number> = {
      '1m': 60 * 1000,
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '30m': 30 * 60 * 1000,
      '1h': 60 * 60 * 1000,
      '4h': 4 * 60 * 60 * 1000,
      '1d': 24 * 60 * 60 * 1000,
    };
    return map[interval] || 15 * 60 * 1000;
  }
}