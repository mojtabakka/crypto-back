import { Injectable, Logger } from '@nestjs/common';
import { MultiExchangeKlineService } from 'src/exchange/multi-exchange-kline.service';
import { FuturesSymbolsService } from 'src/futures-symbols/futures-symbols.service';
import type {
  IchimokuKumoTwistScanParams,
  IchimokuKumoTwistScanResult,
  IchimokuKumoTwistSignal,
  IchimokuNearCloudBottomScanParams,
  IchimokuNearCloudBottomScanResult,
  IchimokuNearCloudBottomSignal,
  IchimokuScanParams,
  IchimokuScanResult,
  IchimokuSignal,
  IchimokuThickCloudPullbackScanParams,
  IchimokuThickCloudPullbackScanResult,
  IchimokuThickCloudPullbackSignal,
} from './types/ichimoku.types';

type SupportedExchange = 'binance' | 'bybit' | 'mexc' | 'toobit';

const LOOKBACK_DAYS = 200;
const MIN_CANDLES = 80;
const DEFAULT_NEAR_CLOUD_THRESHOLD_PCT = 1;
const DEFAULT_THICK_CLOUD_MIN_PCT = 1.5;
const DEFAULT_TOUCH_TOLERANCE_PCT = 0.75;
const DEFAULT_BREAKOUT_LOOKBACK_BARS = 60;
const DEFAULT_KUMO_TWIST_LOOKBACK_BARS = 40;

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

interface IchimokuSnapshot {
  price: number;
  tenkan: number;
  kijun: number;
  spanA: number;
  spanB: number;
  cloudTop: number;
  cloudBottom: number;
}

interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface CloudPoint {
  spanA: number;
  spanB: number;
  cloudTop: number;
  cloudBottom: number;
}

@Injectable()
export class IchimokuScannerService {
  private readonly logger = new Logger(IchimokuScannerService.name);

  constructor(
    private readonly klineService: MultiExchangeKlineService,
    private readonly futuresSymbolsService: FuturesSymbolsService,
  ) {}

  async scan(params: IchimokuScanParams = {}): Promise<IchimokuScanResult> {
    const targetSymbols = await this.resolveTargetSymbols(params.symbols, params.limit);
    const interval = params.interval ?? '1d';
    const exchange = (params.exchange as SupportedExchange) ?? 'binance';

    this.logger.log(
      `Ichimoku scan (price above cloud) started for ${targetSymbols.length} symbols (${interval}, exchange=${exchange})`,
    );

    const concurrency = 5;
    const matches: IchimokuSignal[] = [];

    for (let i = 0; i < targetSymbols.length; i += concurrency) {
      const batch = targetSymbols.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map((sym) => this.evaluateSymbol(sym, interval, exchange)),
      );
      for (const signal of results) {
        if (signal) matches.push(signal);
      }
    }

    matches.sort((a, b) => b.price - a.price);

    return {
      timestamp: new Date().toISOString(),
      interval,
      exchange,
      totalScanned: targetSymbols.length,
      matches,
    };
  }

  async scanNearCloudBottom(
    params: IchimokuNearCloudBottomScanParams = {},
  ): Promise<IchimokuNearCloudBottomScanResult> {
    const targetSymbols = await this.resolveTargetSymbols(params.symbols, params.limit);
    const interval = params.interval ?? '1d';
    const exchange = (params.exchange as SupportedExchange) ?? 'binance';
    const thresholdPct = this.normalizeThreshold(params.thresholdPct);

    this.logger.log(
      `Ichimoku near-cloud-bottom scan started for ${targetSymbols.length} symbols (${interval}, exchange=${exchange}, threshold=${thresholdPct}%)`,
    );

    const concurrency = 5;
    const matches: IchimokuNearCloudBottomSignal[] = [];

    for (let i = 0; i < targetSymbols.length; i += concurrency) {
      const batch = targetSymbols.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map((sym) => this.evaluateNearCloudBottom(sym, interval, exchange, thresholdPct)),
      );
      for (const signal of results) {
        if (signal) matches.push(signal);
      }
    }

    matches.sort(
      (a, b) =>
        Math.abs(a.distanceToCloudBottomPct) - Math.abs(b.distanceToCloudBottomPct),
    );

    return {
      timestamp: new Date().toISOString(),
      interval,
      exchange,
      thresholdPct,
      totalScanned: targetSymbols.length,
      matches,
    };
  }

  async evaluateSymbol(
    symbol: string,
    interval: string,
    exchange: SupportedExchange,
  ): Promise<IchimokuSignal | null> {
    try {
      const candles = await this.loadCandles(symbol, interval, exchange);
      if (!candles) return null;
      return this.computeIchimoku(symbol, candles);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Ichimoku evaluation failed for ${symbol}`, msg);
      return null;
    }
  }

  async evaluateNearCloudBottom(
    symbol: string,
    interval: string,
    exchange: SupportedExchange,
    thresholdPct: number,
  ): Promise<IchimokuNearCloudBottomSignal | null> {
    try {
      const candles = await this.loadCandles(symbol, interval, exchange);
      if (!candles) return null;
      return this.computeNearCloudBottom(symbol, candles, thresholdPct);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Ichimoku near-cloud-bottom evaluation failed for ${symbol}`, msg);
      return null;
    }
  }

  async scanThickCloudPullback(
    params: IchimokuThickCloudPullbackScanParams = {},
  ): Promise<IchimokuThickCloudPullbackScanResult> {
    const targetSymbols = await this.resolveTargetSymbols(params.symbols, params.limit);
    const interval = params.interval ?? '1d';
    const exchange = (params.exchange as SupportedExchange) ?? 'binance';
    const minCloudThicknessPct = this.normalizePositive(params.minCloudThicknessPct, DEFAULT_THICK_CLOUD_MIN_PCT, 30);
    const touchTolerancePct = this.normalizePositive(params.touchTolerancePct, DEFAULT_TOUCH_TOLERANCE_PCT, 10);
    const breakoutLookbackBars = Math.round(this.normalizePositive(params.breakoutLookbackBars, DEFAULT_BREAKOUT_LOOKBACK_BARS, 250));

    this.logger.log(
      `Ichimoku thick-cloud pullback scan started for ${targetSymbols.length} symbols (${interval}, exchange=${exchange}, minThickness=${minCloudThicknessPct}%, tolerance=${touchTolerancePct}%, lookback=${breakoutLookbackBars})`,
    );

    const concurrency = 5;
    const matches: IchimokuThickCloudPullbackSignal[] = [];

    for (let i = 0; i < targetSymbols.length; i += concurrency) {
      const batch = targetSymbols.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map((sym) =>
          this.evaluateThickCloudPullback(
            sym,
            interval,
            exchange,
            minCloudThicknessPct,
            touchTolerancePct,
            breakoutLookbackBars,
          ),
        ),
      );
      for (const signal of results) {
        if (signal) matches.push(signal);
      }
    }

    matches.sort((a, b) => b.cloudThicknessPct - a.cloudThicknessPct);

    return {
      timestamp: new Date().toISOString(),
      interval,
      exchange,
      minCloudThicknessPct,
      touchTolerancePct,
      totalScanned: targetSymbols.length,
      matches,
    };
  }

  async evaluateThickCloudPullback(
    symbol: string,
    interval: string,
    exchange: SupportedExchange,
    minCloudThicknessPct: number,
    touchTolerancePct: number,
    breakoutLookbackBars: number,
  ): Promise<IchimokuThickCloudPullbackSignal | null> {
    try {
      const candles = await this.loadCandles(symbol, interval, exchange);
      if (!candles) return null;
      return this.computeThickCloudPullback(
        symbol,
        candles,
        minCloudThicknessPct,
        touchTolerancePct,
        breakoutLookbackBars,
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Ichimoku thick-cloud pullback evaluation failed for ${symbol}`, msg);
      return null;
    }
  }

  private async loadCandles(
    symbol: string,
    interval: string,
    exchange: SupportedExchange,
  ): Promise<{ openTime: number; open: number; high: number; low: number; close: number }[] | null> {
    const now = Date.now();
    const lookbackDays = INTERVAL_LOOKBACK_DAYS[interval] ?? LOOKBACK_DAYS;
    const startTime = now - lookbackDays * 24 * 60 * 60 * 1000;

    const klines = await this.klineService.getFuturesKlines(
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

    return klines.map((k) => ({
      openTime: k[0],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
    }));
  }

  private computeIchimoku(
    symbol: string,
    candles: {
      openTime: number;
      open: number;
      high: number;
      low: number;
      close: number;
    }[],
  ): IchimokuSignal | null {
    const snapshot = this.computeSnapshot(candles);
    if (!snapshot) return null;

    const { price, tenkan, kijun, spanA, spanB, cloudTop, cloudBottom } = snapshot;
    if (price <= cloudTop) return null;

    return {
      symbol,
      price,
      tenkan,
      kijun,
      spanA,
      spanB,
      chikou: price,
      signal: 'BUY',
      conditions: {
        priceAboveCloud: true,
        tenkanAboveKijun: tenkan > kijun,
        chikouAbovePrice26: price > candles[candles.length - 27].close,
        chikouClean: true,
        breakoutCandleClosed: true,
      },
      cloudTop,
      cloudBottom,
    };
  }

  private computeNearCloudBottom(
    symbol: string,
    candles: {
      openTime: number;
      open: number;
      high: number;
      low: number;
      close: number;
    }[],
    thresholdPct: number,
  ): IchimokuNearCloudBottomSignal | null {
    const snapshot = this.computeSnapshot(candles);
    if (!snapshot) return null;

    const { price, tenkan, kijun, spanA, spanB, cloudTop, cloudBottom } = snapshot;
    if (cloudBottom === 0) return null;

    const distanceToCloudBottomPct = ((price - cloudBottom) / cloudBottom) * 100;
    if (Math.abs(distanceToCloudBottomPct) > thresholdPct) return null;

    const position =
      price > cloudTop
        ? 'ABOVE_CLOUD'
        : price < cloudBottom
          ? 'BELOW_CLOUD'
          : 'INSIDE_CLOUD';

    return {
      symbol,
      price,
      tenkan,
      kijun,
      spanA,
      spanB,
      cloudTop,
      cloudBottom,
      distanceToCloudBottomPct,
      position,
      signal: 'NEAR_CLOUD_BOTTOM',
    };
  }

  private computeSnapshot(
    candles: {
      openTime: number;
      open: number;
      high: number;
      low: number;
      close: number;
    }[],
  ): IchimokuSnapshot | null {
    const n = candles.length;
    const last = n - 1;
    if (last < MIN_CANDLES - 1) return null;

    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);

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

    return {
      price: closes[last],
      tenkan: tenkan[last],
      kijun: kijun[last],
      spanA,
      spanB,
      cloudTop: Math.max(spanA, spanB),
      cloudBottom: Math.min(spanA, spanB),
    };
  }

  async scanKumoTwists(
    params: IchimokuKumoTwistScanParams = {},
  ): Promise<IchimokuKumoTwistScanResult> {
    const targetSymbols = await this.resolveTargetSymbols(params.symbols, params.limit);
    const interval = params.interval ?? '1d';
    const exchange = (params.exchange as SupportedExchange) ?? 'binance';
    const lookbackBars = Math.round(this.normalizePositive(params.lookbackBars, DEFAULT_KUMO_TWIST_LOOKBACK_BARS, 120));

    this.logger.log(
      `Ichimoku kumo twist scan started for ${targetSymbols.length} symbols (${interval}, exchange=${exchange}, lookback=${lookbackBars})`,
    );

    const concurrency = 5;
    const matches: IchimokuKumoTwistSignal[] = [];

    for (let i = 0; i < targetSymbols.length; i += concurrency) {
      const batch = targetSymbols.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map((sym) => this.evaluateKumoTwist(sym, interval, exchange, lookbackBars)),
      );
      for (const signal of results) {
        if (signal) matches.push(signal);
      }
    }

    matches.sort((a, b) => Math.abs(a.twistBarsFromCurrent) - Math.abs(b.twistBarsFromCurrent));

    return {
      timestamp: new Date().toISOString(),
      interval,
      exchange,
      lookbackBars,
      totalScanned: targetSymbols.length,
      matches,
    };
  }

  async evaluateKumoTwist(
    symbol: string,
    interval: string,
    exchange: SupportedExchange,
    lookbackBars: number,
  ): Promise<IchimokuKumoTwistSignal | null> {
    try {
      const candles = await this.loadCandles(symbol, interval, exchange);
      if (!candles) return null;
      return this.computeKumoTwist(symbol, candles, lookbackBars);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Ichimoku kumo twist evaluation failed for ${symbol}`, msg);
      return null;
    }
  }

  private computeKumoTwist(
    symbol: string,
    candles: Candle[],
    lookbackBars: number,
  ): IchimokuKumoTwistSignal | null {
    const snapshot = this.computeSnapshot(candles);
    if (!snapshot) return null;

    const cloudSeries = this.computeCloudSeries(candles);
    const last = candles.length - 1;
    const start = Math.max(78, last - lookbackBars);
    const currentPrice = candles[last].close;

    type Twist = {
      index: number;
      mid: number;
      thicknessPct: number;
      maxThicknessNearPct: number;
      location: 'ABOVE_PRICE' | 'BELOW_PRICE';
    };
    const twists: Twist[] = [];

    for (let i = start + 1; i <= last; i++) {
      const prev = cloudSeries[i - 1];
      const cur = cloudSeries[i];
      if (!prev || !cur) continue;

      const prevDiff = prev.spanA - prev.spanB;
      const curDiff = cur.spanA - cur.spanB;
      const crossed = prevDiff === 0 || curDiff === 0 || prevDiff * curDiff < 0;
      if (!crossed) continue;

      const mid = (cur.cloudTop + cur.cloudBottom) / 2;
      if (mid === 0) continue;
      const thicknessPct = ((cur.cloudTop - cur.cloudBottom) / mid) * 100;
      const location: 'ABOVE_PRICE' | 'BELOW_PRICE' = mid >= currentPrice ? 'ABOVE_PRICE' : 'BELOW_PRICE';

      // "Vase/goldoon": require cloud to open up around the twist (not a flat ribbon).
      const windowStart = Math.max(0, i - 12);
      const windowEnd = Math.min(last, i + 12);
      let maxThicknessNearPct = thicknessPct;
      for (let j = windowStart; j <= windowEnd; j++) {
        const c = cloudSeries[j];
        if (!c) continue;
        const m = (c.cloudTop + c.cloudBottom) / 2;
        if (m === 0) continue;
        const t = ((c.cloudTop - c.cloudBottom) / m) * 100;
        if (t > maxThicknessNearPct) maxThicknessNearPct = t;
      }
      if (maxThicknessNearPct < 0.6) continue; // too flat to read as a "vase" shape

      twists.push({ index: i, mid, thicknessPct, maxThicknessNearPct, location });
    }

    if (twists.length === 0) return null;

    // Prefer twist closest to current price level, then closest in bars.
    twists.sort((a, b) => {
      const da = Math.abs(a.mid - currentPrice) / currentPrice;
      const db = Math.abs(b.mid - currentPrice) / currentPrice;
      if (Math.abs(da - db) > 1e-9) return da - db;
      return Math.abs(last - a.index) - Math.abs(last - b.index);
    });
    const twist = twists[0];

    const { tenkan, kijun, spanA, spanB, cloudTop, cloudBottom, price } = snapshot;
    return {
      symbol,
      price,
      tenkan,
      kijun,
      spanA,
      spanB,
      cloudTop,
      cloudBottom,
      twistBarsFromCurrent: twist.index - last,
      twistCloudMid: twist.mid,
      twistThicknessPct: twist.thicknessPct,
      twistLocation: twist.location,
      maxThicknessNearTwistPct: twist.maxThicknessNearPct,
      signal: 'KUMO_TWIST',
    };
  }

  private computeThickCloudPullback(
    symbol: string,
    candles: Candle[],
    minCloudThicknessPct: number,
    touchTolerancePct: number,
    breakoutLookbackBars: number,
  ): IchimokuThickCloudPullbackSignal | null {
    const snapshot = this.computeSnapshot(candles);
    if (!snapshot) return null;

    const { price, tenkan, kijun, spanA, spanB, cloudTop, cloudBottom } = snapshot;
    if (cloudBottom === 0) return null;

    const cloudThicknessPct = ((cloudTop - cloudBottom) / cloudBottom) * 100;
    if (cloudThicknessPct < minCloudThicknessPct) return null;

    const distanceToCloudBottomPct = ((price - cloudBottom) / cloudBottom) * 100;
    const lastCandle = candles[candles.length - 1];
    const touchBandTop = cloudBottom * (1 + touchTolerancePct / 100);

    const closedDeepInsideCloud = lastCandle.close < cloudBottom;
    const clearlyAboveTouch = lastCandle.low > touchBandTop;
    if (closedDeepInsideCloud || clearlyAboveTouch) return null;

    const wickTouchedBottom = lastCandle.low <= touchBandTop && lastCandle.close >= cloudBottom;
    const insideNearBottom = lastCandle.close >= cloudBottom && lastCandle.close <= touchBandTop;
    if (!wickTouchedBottom && !insideNearBottom) return null;

    const pullbackTouchType = insideNearBottom
      ? lastCandle.low <= cloudBottom
        ? 'WICK_TOUCH'
        : 'INSIDE_NEAR_BOTTOM'
      : 'CLOSE_ABOVE_BOTTOM';

    const cloudSeries = this.computeCloudSeries(candles);
    const breakout = this.findBullishBreakoutBeforePullback(candles, cloudSeries, breakoutLookbackBars);
    if (!breakout) return null;

    return {
      symbol,
      price,
      tenkan,
      kijun,
      spanA,
      spanB,
      cloudTop,
      cloudBottom,
      cloudThicknessPct,
      breakoutBarsAgo: breakout.barsAgo,
      breakoutPrice: breakout.price,
      pullbackTouchType,
      distanceToCloudBottomPct,
      signal: 'THICK_CLOUD_PULLBACK',
    };
  }

  private computeCloudSeries(candles: Candle[]): Array<CloudPoint | null> {
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const tenkan = this.computeTenkanKijun(highs, lows, 8);
    const kijun = this.computeTenkanKijun(highs, lows, 25);

    return candles.map((_, i) => {
      const cloudIndex = i - 26;
      if (cloudIndex < 25) return null;

      const t = tenkan[cloudIndex];
      const k = kijun[cloudIndex];
      if (!Number.isFinite(t) || !Number.isFinite(k)) return null;

      const spanA = (t + k) / 2;
      const spanBStart = cloudIndex - 51;
      if (spanBStart < 0) return null;

      const spanB =
        (this.highest(highs, spanBStart, cloudIndex) +
          this.lowest(lows, spanBStart, cloudIndex)) /
        2;

      return {
        spanA,
        spanB,
        cloudTop: Math.max(spanA, spanB),
        cloudBottom: Math.min(spanA, spanB),
      };
    });
  }

  private findBullishBreakoutBeforePullback(
    candles: Candle[],
    cloudSeries: Array<CloudPoint | null>,
    lookbackBars: number,
  ): { barsAgo: number; price: number } | null {
    const last = candles.length - 1;
    const start = Math.max(77, last - lookbackBars);

    let breakout: { barsAgo: number; price: number } | null = null;
    let wasAboveCloud = false;

    for (let i = start; i < last; i++) {
      const cloud = cloudSeries[i];
      if (!cloud) continue;

      const close = candles[i].close;
      const prevClose = i > 0 ? candles[i - 1].close : close;
      const prevCloud = cloudSeries[i - 1];

      const crossedUp =
        prevCloud != null && prevClose <= prevCloud.cloudTop && close > cloud.cloudTop;
      const closedAbove = close > cloud.cloudTop;

      if (crossedUp) {
        breakout = { barsAgo: last - i, price: close };
        wasAboveCloud = true;
        continue;
      }

      if (breakout && closedAbove) {
        wasAboveCloud = true;
      }

      // If it fell meaningfully back into/below cloud after breakout and never re-established,
      // we still keep the most recent valid breakout as long as it spent time above cloud.
      if (breakout && prevCloud != null && close < cloud.cloudBottom && !wasAboveCloud) {
        breakout = null;
      }
    }

    if (!breakout || breakout.barsAgo < 2) return null;
    return breakout;
  }

  private normalizePositive(value: number | string | undefined, fallback: number, max: number): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(parsed, max);
  }

  private normalizeThreshold(value: number | string | undefined): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_NEAR_CLOUD_THRESHOLD_PCT;
    return Math.min(parsed, 20);
  }

  private async resolveTargetSymbols(
    symbols: string | undefined,
    limit: number | string | undefined,
  ): Promise<string[]> {
    let resolved: string[];

    if (symbols) {
      resolved = symbols
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean);
    } else {
      resolved = await this.getStoredUsdtSymbols();
    }

    const parsedLimit = Number(limit);
    return parsedLimit > 0 ? resolved.slice(0, parsedLimit) : resolved;
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
