export interface IchimokuInputs {
  highs: number[];
  lows: number[];
  closes: number[];
}

export interface IchimokuResult {
  tenkan: number;
  kijun: number;
  spanA: number;
  spanB: number;
  cloudTop: number;
  cloudBottom: number;
  chikouValue: number;
  cloudIndex: number;
}

export interface Candle {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const TENKAN_PERIOD = 9;
const KIJUN_PERIOD = 26;
const SPAN_B_PERIOD = 52;

export class IchimokuCalculatorService {
  /**
   * Compute Ichimoku components for the given candles.
   * Returns null if there is not enough data.
   */
  compute(candles: Candle[]): IchimokuResult | null {
    const n = candles.length;
    if (n < KIJUN_PERIOD + 1) return null;

    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const closes = candles.map((c) => c.close);

    const last = n - 1;
    const cloudIndex = last - KIJUN_PERIOD;
    if (cloudIndex < KIJUN_PERIOD - 1) return null;

    const tenkanSeries = this.computeTenkanKijun(highs, lows, TENKAN_PERIOD);
    const kijunSeries = this.computeTenkanKijun(highs, lows, KIJUN_PERIOD);

    const tenkan = tenkanSeries[last];
    const kijun = kijunSeries[last];
    if (isNaN(tenkan) || isNaN(kijun)) return null;

    const spanA = (tenkan + kijun) / 2;

    const spanBStart = cloudIndex - (SPAN_B_PERIOD - 1);
    if (spanBStart < 0) return null;

    const spanB =
      (this.highest(highs, spanBStart, cloudIndex) +
        this.lowest(lows, spanBStart, cloudIndex)) /
      2;

    return {
      tenkan,
      kijun,
      spanA,
      spanB,
      cloudTop: Math.max(spanA, spanB),
      cloudBottom: Math.min(spanA, spanB),
      chikouValue: closes[last],
      cloudIndex,
    };
  }

  computeTenkanKijun(
    highs: number[],
    lows: number[],
    lookback: number,
  ): number[] {
    const n = highs.length;
    const result: number[] = new Array(n).fill(NaN);

    for (let i = lookback; i < n; i++) {
      const hh = this.highest(highs, i - lookback, i);
      const ll = this.lowest(lows, i - lookback, i);
      result[i] = (hh + ll) / 2;
    }

    return result;
  }

  highest(arr: number[], start: number, end: number): number {
    let max = arr[start];
    for (let i = start + 1; i <= end; i++) {
      if (arr[i] > max) max = arr[i];
    }
    return max;
  }

  lowest(arr: number[], start: number, end: number): number {
    let min = arr[start];
    for (let i = start + 1; i <= end; i++) {
      if (arr[i] < min) min = arr[i];
    }
    return min;
  }
}