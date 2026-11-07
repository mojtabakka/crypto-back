import { Injectable, Logger } from '@nestjs/common';
import { MultiExchangeKlineService } from 'src/exchange/multi-exchange-kline.service';
import { FuturesSymbolsService } from 'src/futures-symbols/futures-symbols.service';
import { VolumeMarketCapService } from 'src/volume-marketcap/volume-marketcap.service';
import type {
  IchimokuCloudBottomTouchScanParams,
  IchimokuCloudBottomTouchScanResult,
  IchimokuCloudBottomTouchSignal,
} from './types/ichimoku-cloud-bottom-touch.types';

type SupportedExchange = 'binance' | 'bybit' | 'mexc' | 'toobit';

const LOOKBACK_DAYS = 200;
const MIN_CANDLES = 100;
const CLOUD_TOUCH_TOLERANCE_PCT = 1.5; // Price within 1.5% of cloud bottom

const INTERVAL_LOOKBACK_DAYS: Record<string, number> = {
  '1m': 3,
  '3m': 5,
  '5m': 10,
  '15m': 20,
  '30m': 30,
  '1h': 60,
  '2h': 80,
  '4h': 100,
  '6h': 120,
  '8h': 140,
  '12h': 160,
  '1d': 200,
  '3d': 250,
  '1w': 300,
};

interface FuturesSymbol {
  symbol: string;
  quoteAsset: string;
  status: string;
  contractType: string;
}

@Injectable()
export class IchimokuCloudBottomTouchService {
  private readonly logger = new Logger(IchimokuCloudBottomTouchService.name);

  constructor(
    private readonly klineService: MultiExchangeKlineService,
    private readonly futuresSymbolsService: FuturesSymbolsService,
    private readonly volumeMarketCapService: VolumeMarketCapService,
  ) {}

  async scan(
    params: IchimokuCloudBottomTouchScanParams = {},
  ): Promise<IchimokuCloudBottomTouchScanResult> {
    let symbols: string[];

    if (params.symbols) {
      symbols = params.symbols
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
    } else {
      symbols = await this.getStoredUsdtSymbols();
    }

    const limit = params.limit ? Number(params.limit) : 0;
    const targetSymbols = limit > 0 ? symbols.slice(0, limit) : symbols;

    const interval = params.interval ?? '1d';
    const exchange = (params.exchange as SupportedExchange) ?? 'binance';

    this.logger.log(
      `Ichimoku Cloud Bottom Touch scan started for ${targetSymbols.length} symbols (${interval}, exchange=${exchange})`,
    );

    const marketData =
      await this.volumeMarketCapService.getCoinMarketMap(exchange);

    const concurrency = 5;
    const matches: IchimokuCloudBottomTouchSignal[] = [];

    for (let i = 0; i < targetSymbols.length; i += concurrency) {
      const batch = targetSymbols.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map((sym) =>
          this.evaluateSymbol(sym, interval, exchange, marketData),
        ),
      );
      for (const signal of results) {
        if (signal) matches.push(signal);
      }
    }

    matches.sort(
      (a, b) =>
        a.priceDistanceToCloudBottomPct - b.priceDistanceToCloudBottomPct,
    );

    return {
      timestamp: new Date().toISOString(),
      interval,
      exchange,
      totalScanned: targetSymbols.length,
      matches,
    };
  }

  async evaluateSymbol(
    symbol: string,
    interval: string,
    exchange: SupportedExchange,
    marketData: Map<string, { marketCap: number; volume24h: number }>,
  ): Promise<IchimokuCloudBottomTouchSignal | null> {
    try {
      const now = Date.now();
      const lookbackDays = INTERVAL_LOOKBACK_DAYS[interval] ?? LOOKBACK_DAYS;
      const startTime = now - lookbackDays * 24 * 60 * 60 * 1000;

      const klines = await this.fetchFuturesKlines(
        symbol,
        interval,
        startTime,
        now,
        1000,
        exchange,
      );

      if (!klines || klines.length < MIN_CANDLES) {
        return null;
      }

      const candles = klines.map((k) => ({
        openTime: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
      }));

      const signal = this.computeCloudBottomTouch(symbol, candles, marketData);
      return signal;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Ichimoku Cloud Bottom Touch evaluation failed for ${symbol} on ${exchange}`,
        msg,
      );
      return null;
    }
  }

  private async fetchFuturesKlines(
    symbol: string,
    interval: string,
    startTime: number,
    endTime: number,
    limit: number,
    exchange: SupportedExchange,
  ) {
    return this.klineService.getFuturesKlines(
      symbol,
      interval,
      startTime,
      endTime,
      limit,
      exchange,
    );
  }

  private computeCloudBottomTouch(
    symbol: string,
    candles: {
      openTime: number;
      open: number;
      high: number;
      low: number;
      close: number;
    }[],
    marketData: Map<string, { marketCap: number; volume24h: number }>,
  ): IchimokuCloudBottomTouchSignal | null {
    const n = candles.length;
    if (n < MIN_CANDLES) return null;

    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);

    const last = n - 1;

    // ============ Ichimoku Cloud ============
    const tenkan = this.computeTenkanKijun(highs, lows, 8);
    const kijun = this.computeTenkanKijun(highs, lows, 25);

    const cloudIndex = last - 26;
    if (cloudIndex < 25) return null;

    const spanA = (tenkan[cloudIndex] + kijun[cloudIndex]) / 2;
    const spanBStart = cloudIndex - 51;
    if (spanBStart < 0) return null;

    const spanB =
      (this.highest(highs, spanBStart, cloudIndex) +
        this.lowest(lows, spanBStart, cloudIndex)) /
      2;

    const price = closes[last];
    const cloudTop = Math.max(spanA, spanB);
    const cloudBottom = Math.min(spanA, spanB);

    // Condition 1: Price must be very close to cloud bottom (within tolerance)
    const tolerance = cloudBottom * (CLOUD_TOUCH_TOLERANCE_PCT / 100);
    const priceDistanceToCloudBottomPct =
      ((price - cloudBottom) / cloudBottom) * 100;

    if (priceDistanceToCloudBottomPct > CLOUD_TOUCH_TOLERANCE_PCT) {
      return null;
    }

    // Condition 2: Price should be at or very near cloud bottom
    // Allow small tolerance above or below cloud bottom
    if (price < cloudBottom - tolerance) {
      return null; // Price is below cloud, not touching
    }

    // Condition 3: Check if price was previously above cloud (first touch detection)
    // Look back to see if price was above cloud recently
    let barsSinceAboveCloud: number | null = null;
    let wasAboveCloud = false;

    // Look back up to 50 bars to see if price was above cloud top
    for (let j = last - 1; j >= Math.max(0, last - 50); j--) {
      const cloudIndexJ = j - 26;
      if (cloudIndexJ < 25) continue;

      const spanA_j = (tenkan[cloudIndexJ] + kijun[cloudIndexJ]) / 2;
      const spanBStart_j = cloudIndexJ - 51;
      if (spanBStart_j < 0) continue;

      const spanB_j =
        (this.highest(highs, spanBStart_j, cloudIndexJ) +
          this.lowest(lows, spanBStart_j, cloudIndexJ)) /
        2;

      const cloudTop_j = Math.max(spanA_j, spanB_j);

      if (closes[j] > cloudTop_j) {
        wasAboveCloud = true;
        barsSinceAboveCloud = last - j;
        break;
      }
    }

    // Score based on how close to cloud bottom and how recent the break above cloud was
    let score = 0;
    score += Math.max(0, 10 - Math.abs(priceDistanceToCloudBottomPct)) * 5; // Closer to cloud bottom = higher score
    if (
      wasAboveCloud &&
      barsSinceAboveCloud !== null &&
      barsSinceAboveCloud <= 10
    ) {
      score += 30; // Recently above cloud = higher score
    } else if (
      wasAboveCloud &&
      barsSinceAboveCloud !== null &&
      barsSinceAboveCloud <= 30
    ) {
      score += 15; // Somewhat recently above cloud = medium score
    }

    const marketInfo = marketData.get(symbol) ?? { marketCap: 0, volume24h: 0 };

    return {
      symbol,
      price,
      tenkan: tenkan[last],
      kijun: kijun[last],
      spanA,
      spanB,
      cloudTop,
      cloudBottom,
      priceDistanceToCloudBottomPct,
      wasAboveCloud,
      barsSinceAboveCloud,
      score,
      volumeRatio: 0,
      marketCap: marketInfo.marketCap,
      volume24h: marketInfo.volume24h,
      signal: 'BUY',
    };
  }

  private computeTenkanKijun(
    highs: number[],
    lows: number[],
    lookback: number,
  ): number[] {
    const n = highs.length;
    const result: number[] = Array.from({ length: n }, () => NaN);

    for (let i = lookback; i < n; i++) {
      const hh = this.highest(highs, i - lookback, i);
      const ll = this.lowest(lows, i - lookback, i);
      result[i] = (hh + ll) / 2;
    }

    return result;
  }

  private highest(arr: number[], start: number, end: number): number {
    let max = arr[start];
    for (let i = start + 1; i <= end; i++) {
      if (arr[i] > max) max = arr[i];
    }
    return max;
  }

  private lowest(arr: number[], start: number, end: number): number {
    let min = arr[start];
    for (let i = start + 1; i <= end; i++) {
      if (arr[i] < min) min = arr[i];
    }
    return min;
  }

  async getStoredUsdtSymbols(): Promise<string[]> {
    const stored = await this.futuresSymbolsService.getStoredSymbols();
    const symbols: string[] = [];
    for (const s of stored.symbols as FuturesSymbol[]) {
      if (
        s.quoteAsset === 'USDT' &&
        s.status === 'TRADING' &&
        s.contractType === 'PERPETUAL'
      ) {
        symbols.push(s.symbol);
      }
    }
    return symbols;
  }
}
