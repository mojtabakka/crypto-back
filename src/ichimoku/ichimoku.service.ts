import { Injectable } from '@nestjs/common';
import { Candle, MarketDataService } from 'src/analytics/market-data.service';
import {
  IchimokuCombinedSignal,
  IchimokuLaggingSpanSignal,
  IchimokuSignal,
} from 'src/types/ichimoku';

const clamp = (value: number, min = 0, max = 100) =>
  Math.max(min, Math.min(max, value));

function highest(candles: Candle[], end: number, period: number): number {
  return Math.max(...candles.slice(end - period + 1, end + 1).map((c) => c.high));
}

function lowest(candles: Candle[], end: number, period: number): number {
  return Math.min(...candles.slice(end - period + 1, end + 1).map((c) => c.low));
}

/** Midpoint of a Donchian channel — the building block of every Ichimoku line. */
function mid(candles: Candle[], end: number, period: number): number | null {
  if (end - period + 1 < 0) return null;
  return (highest(candles, end, period) + lowest(candles, end, period)) / 2;
}

@Injectable()
export class IchimokuService {
  constructor(private readonly marketData: MarketDataService) {}

  private buildSignal(
    symbol: string,
    candles: Candle[],
    interval: string,
  ): IchimokuSignal | null {
    if (candles.length < 80) return null;

    const index = candles.length - 1;
    const price = candles[index].close;

    const tenkan = mid(candles, index, 9);
    const kijun = mid(candles, index, 26);
    const spanA = mid(candles, index - 26, 9);
    const spanB = mid(candles, index - 26, 52);

    if (
      tenkan === null ||
      kijun === null ||
      spanA === null ||
      spanB === null
    ) {
      return null;
    }

    // SpanA is the average of the two lines 26 bars back, not today's.
    const spanAValue =
      ((mid(candles, index - 26, 9) ?? 0) + (mid(candles, index - 26, 26) ?? 0)) / 2;
    const cloudTop = Math.max(spanAValue, spanB);
    const cloudBottom = Math.min(spanAValue, spanB);

    const priorClose = candles[index - 26]?.close ?? price;
    const priorHigh = candles[index - 26]?.high ?? price;
    const chikou = price;

    const conditions = {
      priceAboveCloud: price > cloudTop,
      tenkanAboveKijun: tenkan > kijun,
      chikouAbovePrice26: chikou > priorClose,
      chikouClean: chikou > priorHigh,
      breakoutCandleClosed: price > (candles[index - 1]?.high ?? price),
    };

    const coreHits = [
      conditions.priceAboveCloud,
      conditions.tenkanAboveKijun,
      conditions.chikouAbovePrice26,
    ].filter(Boolean).length;

    const bonusHits = [conditions.chikouClean, conditions.breakoutCandleClosed]
      .filter(Boolean).length;

    const signal: 'BUY' | 'NEUTRAL' =
      coreHits === 3 ? 'BUY' : coreHits === 2 && bonusHits === 2 ? 'BUY' : 'NEUTRAL';

    return {
      symbol,
      price,
      tenkan: Number(tenkan.toFixed(8)),
      kijun: Number(kijun.toFixed(8)),
      spanA: Number(spanAValue.toFixed(8)),
      spanB: Number(spanB.toFixed(8)),
      chikou: Number(chikou.toFixed(8)),
      signal,
      conditions,
      cloudTop: Number(cloudTop.toFixed(8)),
      cloudBottom: Number(cloudBottom.toFixed(8)),
    };
  }

  private findLaggingCross(
    symbol: string,
    candles: Candle[],
  ): IchimokuLaggingSpanSignal | null {
    const n = candles.length;
    if (n < 90) return null;

    // Walk back through the 90 most recent bars looking for the latest
    // confirmed chikou-span break above the price 26 bars behind it.
    for (let i = n - 1; i >= Math.max(n - 90, 53); i--) {
      const plotIndex = i - 26;
      if (plotIndex < 1) break;

      const chikouValue = candles[i].close;
      const crossedUp =
        chikouValue > candles[plotIndex].high &&
        candles[i - 1].close <= candles[plotIndex - 1].high;

      if (!crossedUp) continue;

      const barsAgo = n - 1 - plotIndex;
      if (barsAgo > 20) return null;

      return {
        symbol,
        price: candles[n - 1].close,
        chikouValue,
        crossCandleIndex: plotIndex,
        crossTime: candles[plotIndex].time,
        crossPriceHigh: candles[plotIndex].high,
        barsAgo,
        signal: 'BUY',
      };
    }

    return null;
  }

  private async resolveSymbols(
    symbolsParam: string | undefined,
    limit: number,
  ): Promise<string[]> {
    if (symbolsParam && symbolsParam.trim()) {
      return symbolsParam
        .split(',')
        .map((symbol) => symbol.trim().toUpperCase())
        .filter(Boolean)
        .slice(0, limit);
    }

    return this.marketData.getSymbols(limit);
  }

  async scan(
    symbolsParam?: string,
    limit = 80,
    interval = '1h',
  ): Promise<{
    timestamp: string;
    interval: string;
    totalScanned: number;
    matches: IchimokuSignal[];
  }> {
    const symbols = await this.resolveSymbols(symbolsParam, limit);

    const results = await this.marketData.mapLimit(symbols, 5, async (symbol) => {
      const candles = await this.marketData
        .getCandles(symbol, interval, 160)
        .catch(() => [] as Candle[]);
      return this.buildSignal(symbol, candles, interval);
    });

    const matches = results
      .filter((signal): signal is IchimokuSignal => signal !== null)
      .sort((a, b) => {
        const score = (s: IchimokuSignal) =>
          Object.values(s.conditions).filter(Boolean).length * 10 +
          (s.price / Math.max(s.cloudBottom, 1e-9) - 1);
        return score(b) - score(a);
      });

    return {
      timestamp: new Date().toISOString(),
      interval,
      totalScanned: symbols.length,
      matches,
    };
  }

  async scanLaggingSpan(
    symbolsParam?: string,
    limit = 80,
    interval = '1h',
  ): Promise<{
    timestamp: string;
    interval: string;
    totalScanned: number;
    matches: IchimokuLaggingSpanSignal[];
  }> {
    const symbols = await this.resolveSymbols(symbolsParam, limit);

    const results = await this.marketData.mapLimit(symbols, 5, async (symbol) => {
      const candles = await this.marketData
        .getCandles(symbol, interval, 160)
        .catch(() => [] as Candle[]);
      return this.findLaggingCross(symbol, candles);
    });

    const matches = results
      .filter((signal): signal is IchimokuLaggingSpanSignal => signal !== null)
      .sort((a, b) => a.barsAgo - b.barsAgo);

    return {
      timestamp: new Date().toISOString(),
      interval,
      totalScanned: symbols.length,
      matches,
    };
  }

  async scanCombined(
    symbolsParam?: string,
    limit = 80,
    interval = '1h',
  ): Promise<{
    timestamp: string;
    interval: string;
    totalScanned: number;
    matches: IchimokuCombinedSignal[];
  }> {
    const symbols = await this.resolveSymbols(symbolsParam, limit);

    const results = await this.marketData.mapLimit(symbols, 5, async (symbol) => {
      const candles = await this.marketData
        .getCandles(symbol, interval, 160)
        .catch(() => [] as Candle[]);

      const cloud = this.buildSignal(symbol, candles, interval);
      const lagging = this.findLaggingCross(symbol, candles);

      if (!cloud || !lagging || cloud.signal !== 'BUY') return null;

      return {
        symbol,
        price: cloud.price,
        tenkan: cloud.tenkan,
        kijun: cloud.kijun,
        spanA: cloud.spanA,
        spanB: cloud.spanB,
        cloudTop: cloud.cloudTop,
        cloudBottom: cloud.cloudBottom,
        chikouValue: lagging.chikouValue,
        crossPriceHigh: lagging.crossPriceHigh,
        barsAgo: lagging.barsAgo,
        signal: 'BUY' as const,
      };
    });

    const matches = results
      .filter((signal): signal is IchimokuCombinedSignal => signal !== null)
      .sort((a, b) => a.barsAgo - b.barsAgo);

    return {
      timestamp: new Date().toISOString(),
      interval,
      totalScanned: symbols.length,
      matches,
    };
  }
}
