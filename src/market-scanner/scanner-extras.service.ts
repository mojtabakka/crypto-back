import { Injectable } from '@nestjs/common';
import { Candle, MarketDataService } from 'src/analytics/market-data.service';
import { LiquidationService } from 'src/liquidation/liquidation.service';
import {
  BTCCandleResult,
  DojiCandle,
  DojiCandlesResult,
  FakeSignalRisk,
  FakeSignalScanResult,
  FundingExtremeResult,
  FundingVolumeSqueeze,
  FundingVolumeSqueezeResult,
  LiquidationCluster,
  LiquidationClustersResult,
  StrongSignalResult,
  TrustedLongShortResult,
  TrustedSignal,
} from 'src/types/market-scanner';

const clamp = (value: number, min = 0, max = 100) =>
  Math.max(min, Math.min(max, value));

function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const seed = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const k = 2 / (period + 1);
  let value = seed;
  for (let i = period; i < values.length; i++) {
    value = values[i] * k + value * (1 - k);
  }
  return value;
}

function rsi(values: number[], period = 14): number | null {
  if (values.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/**
 * Extra Market Scanner tabs that had no backend: reliable, shorts, fake signals,
 * funding extremes, strong/trusted signals, doji candles, squeeze, BTC sequence,
 * liquidation clusters and CSV export.
 */
@Injectable()
export class ScannerExtrasService {
  constructor(
    private readonly marketData: MarketDataService,
    private readonly liquidationService: LiquidationService,
  ) {}

  /** EMA50 trend with volume and RSI confirmation — the "reliable" tab. */
  async reliable(limit = 30): Promise<{
    longs: Array<Record<string, unknown>>;
    shorts: Array<Record<string, unknown>>;
  }> {
    const symbols = await this.marketData.getSymbols(120);
    const tickers = await this.marketData.getTickerMap();

    const rows = await this.marketData.mapLimit(symbols, 6, async (symbol) => {
      const candles = await this.marketData
        .getCandles(symbol, '4h', 160)
        .catch(() => [] as Candle[]);
      if (candles.length < 80) return null;

      const closes = candles.map((c) => c.close);
      const price = closes[closes.length - 1];
      const emaNow = ema(closes, 50);
      const emaBefore = ema(closes.slice(0, -10), 50);
      if (emaNow === null || emaBefore === null) return null;

      const rsiValue = rsi(closes, 14) ?? 50;
      const avgVolume =
        candles.slice(-21, -1).reduce((a, c) => a + c.quoteVolume, 0) / 20;
      const volumeRatio =
        avgVolume > 0 ? candles[candles.length - 1].quoteVolume / avgVolume : 1;

      const priceVsEma50 = ((price - emaNow) / emaNow) * 100;
      const trendingUp = price > emaNow && emaNow > emaBefore;
      const trendingDown = price < emaNow && emaNow < emaBefore;

      if (!trendingUp && !trendingDown) return null;

      const directional = trendingUp
        ? clamp(45 + priceVsEma50 * 2 + (rsiValue - 50) * 0.4 + Math.min(15, volumeRatio * 4))
        : clamp(45 + Math.abs(priceVsEma50) * 2 + (50 - rsiValue) * 0.4 + Math.min(15, volumeRatio * 4));

      return {
        symbol,
        score: Number(directional.toFixed(1)),
        signal: trendingUp ? 'RELIABLE_LONG' : 'RELIABLE_SHORT',
        confidence: Number(clamp(40 + directional * 0.5).toFixed(1)),
        priceChange: tickers.get(symbol)?.priceChangePercent ?? 0,
        oiChange: 0,
        fundingRate: 0,
        sma50: Number(emaNow.toFixed(8)),
        priceVsSma50: Number(priceVsEma50.toFixed(3)),
        maSignal: trendingUp ? 'ABOVE' : 'BELOW',
        currentPrice: price,
        direction: trendingUp ? 'LONG' : 'SHORT',
      };
    });

    const ranked = rows
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => b.score - a.score);

    return {
      longs: ranked
        .filter((row) => row.direction === 'LONG')
        .slice(0, limit)
        .map(({ direction: _direction, ...row }) => row),
      shorts: ranked
        .filter((row) => row.direction === 'SHORT')
        .slice(0, limit)
        .map(({ direction: _direction, ...row }) => row),
    };
  }

  /** Short setups on 1h/4h/1d or a blended "combined" view. */
  async shorts(
    timeframe = 'combined',
    limit = 30,
  ): Promise<{ longs: Array<Record<string, unknown>>; shorts: Array<Record<string, unknown>> }> {
    const interval = ['1h', '4h', '1d'].includes(timeframe) ? timeframe : '4h';
    const symbols = await this.marketData.getSymbols(120);
    const tickers = await this.marketData.getTickerMap();

    const rows = await this.marketData.mapLimit(symbols, 6, async (symbol) => {
      const candles = await this.marketData
        .getCandles(symbol, interval, 160)
        .catch(() => [] as Candle[]);
      if (candles.length < 80) return null;

      const closes = candles.map((c) => c.close);
      const price = closes[closes.length - 1];
      const emaNow = ema(closes, 50);
      if (emaNow === null) return null;

      const rsiValue = rsi(closes, 14) ?? 50;
      const priceVsEma50 = ((price - emaNow) / emaNow) * 100;

      // Short setup: trading below EMA50 with weak RSI and a lower high.
      if (price >= emaNow || rsiValue > 52) return null;

      const recentHigh = Math.max(...candles.slice(-12).map((c) => c.high));
      if (recentHigh < price * 1.01) return null;

      const score = clamp(45 + Math.abs(priceVsEma50) * 2.5 + (50 - rsiValue) * 0.6);

      return {
        symbol,
        score: Number(score.toFixed(1)),
        signal: `SHORT_${interval.toUpperCase()}`,
        confidence: Number(clamp(score * 0.9).toFixed(1)),
        priceChange: tickers.get(symbol)?.priceChangePercent ?? 0,
        oiChange: 0,
        fundingRate: 0,
        sma50: Number(emaNow.toFixed(8)),
        priceVsSma50: Number(priceVsEma50.toFixed(3)),
        maSignal: 'BELOW' as const,
        currentPrice: price,
      };
    });

    const ranked = rows
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return { longs: [], shorts: ranked };
  }

  /** Probability that a breakout is a fake-out. */
  async fakeSignals(limit = 30): Promise<FakeSignalScanResult> {
    const started = Date.now();
    const symbols = await this.marketData.getSymbols(100);

    const risks = await this.marketData.mapLimit(symbols, 6, async (symbol) => {
      const candles = await this.marketData
        .getCandles(symbol, '4h', 120)
        .catch(() => [] as Candle[]);
      if (candles.length < 60) return null;

      const closes = candles.map((c) => c.close);
      const price = closes[closes.length - 1];
      const ema50 = ema(closes, 50);
      if (ema50 === null) return null;

      const rsiValue = rsi(closes, 14) ?? 50;
      const prev = candles[candles.length - 2];
      const last = candles[candles.length - 1];
      const avgVolume = candles.slice(-21, -1).reduce((a, c) => a + c.quoteVolume, 0) / 20;
      const volumeRatio = avgVolume > 0 ? last.quoteVolume / avgVolume : 1;
      const momentum = ((last.close - prev.close) / prev.close) * 100;
      const priceVsEma50 = ((price - ema50) / ema50) * 100;

      let probability = 20;
      if (volumeRatio < 0.8) probability += 25;
      if (Math.abs(priceVsEma50) > 8) probability += 20;
      if (rsiValue > 75 || rsiValue < 25) probability += 20;
      if (Math.sign(momentum) !== Math.sign(priceVsEma50)) probability += 15;

      probability = clamp(probability);

      return {
        symbol,
        fakeSignalProbability: Number(probability.toFixed(1)),
        riskLevel: probability >= 65 ? 'HIGH' : probability >= 40 ? 'MEDIUM' : 'LOW',
        rsi: Number(rsiValue.toFixed(1)),
        priceVsEma50: Number(priceVsEma50.toFixed(2)),
        volumeRatio: Number(volumeRatio.toFixed(2)),
        momentum: Number(momentum.toFixed(2)),
        direction: priceVsEma50 >= 0 ? 'LONG' : 'SHORT',
      } as FakeSignalRisk;
    });

    const cleaned = risks
      .filter((risk): risk is FakeSignalRisk => risk !== null)
      .filter((risk) => risk.fakeSignalProbability >= 40)
      .sort((a, b) => b.fakeSignalProbability - a.fakeSignalProbability)
      .slice(0, limit);

    return {
      risks: cleaned,
      scanned: symbols.length,
      duration: Date.now() - started,
      timestamp: new Date().toISOString(),
    };
  }

  /** Crowded funding with a directional squeeze target set. */
  async fundingExtreme(limit = 30): Promise<FundingExtremeResult> {
    const started = Date.now();
    const funding = await this.marketData.getFundingMap();
    const tickers = await this.marketData.getTickerMap();

    const symbols = [...funding.entries()]
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, limit * 3)
      .map(([symbol, rate]) => ({ symbol, rate }));

    const rows = symbols
      .map(({ symbol, rate }) => {
        const ticker = tickers.get(symbol);
        if (!ticker) return null;

        const price = ticker.lastPrice;
        const direction =
          rate > 0.0005
            ? 'LONG_SQUEEZE'
            : rate < -0.0005
              ? 'SHORT_SQUEEZE'
              : 'NEUTRAL';

        const sign = direction === 'LONG_SQUEEZE' ? -1 : 1;

        return {
          symbol,
          fundingRate: rate,
          priceChange: ticker.priceChangePercent,
          signal:
            direction === 'LONG_SQUEEZE'
              ? 'Crowded longs — squeeze risk'
              : direction === 'SHORT_SQUEEZE'
                ? 'Crowded shorts — squeeze risk'
                : 'Balanced funding',
          direction,
          target1: Number((price * (1 + sign * 0.02)).toFixed(8)),
          target2: Number((price * (1 + sign * 0.04)).toFixed(8)),
          target3: Number((price * (1 + sign * 0.06)).toFixed(8)),
        } as const;
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .filter((row) => row.direction !== 'NEUTRAL')
      .slice(0, limit);

    return {
      symbols: rows,
      scanned: funding.size,
      duration: Date.now() - started,
      timestamp: new Date().toISOString(),
    };
  }

  private async trendSignals(limit: number, onlyTrusted: boolean): Promise<TrustedLongShortResult> {
    const started = Date.now();
    const symbols = await this.marketData.getSymbols(100);
    const tickers = await this.marketData.getTickerMap();

    const rows = await this.marketData.mapLimit(symbols, 6, async (symbol) => {
      const candles = await this.marketData
        .getCandles(symbol, '4h', 160)
        .catch(() => [] as Candle[]);
      if (candles.length < 80) return null;

      const closes = candles.map((c) => c.close);
      const price = closes[closes.length - 1];
      const ema50 = ema(closes, 50);
      const ema20 = ema(closes, 20);
      if (ema50 === null || ema20 === null) return null;

      const rsiValue = rsi(closes, 14) ?? 50;
      const ticker = tickers.get(symbol);
      const priceChange = ticker?.priceChangePercent ?? 0;
      const avgVolume = candles.slice(-21, -1).reduce((a, c) => a + c.quoteVolume, 0) / 20;
      const volumeRatio = avgVolume > 0 ? candles[candles.length - 1].quoteVolume / avgVolume : 1;

      const bullish = price > ema50 && ema20 > ema50 && rsiValue >= 50;
      const bearish = price < ema50 && ema20 < ema50 && rsiValue <= 50;
      if (!bullish && !bearish) return null;

      const score = clamp(
        (bullish ? 50 : 50) +
          Math.abs(((price - ema50) / ema50) * 100) * 2 +
          Math.min(20, volumeRatio * 5) +
          (bullish ? (rsiValue - 50) : (50 - rsiValue)) * 0.4,
      );

      const verified =
        (ticker?.quoteVolume ?? 0) > 10_000_000 && volumeRatio >= 1;

      if (onlyTrusted && !verified) return null;

      const trustBadges = [
        verified ? 'Liquid market' : null,
        volumeRatio >= 1.2 ? `Volume ${volumeRatio.toFixed(1)}x` : null,
        Math.abs(rsiValue - 50) > 8 ? 'Momentum confirmed' : null,
      ].filter((badge): badge is string => badge !== null);

      const signal: TrustedSignal = {
        symbol,
        score: Number(score.toFixed(1)),
        signal: bullish ? 'STRONG_LONG' : 'STRONG_SHORT',
        confidence: Number(clamp(score * 0.95).toFixed(1)),
        priceChange,
        oiChange: 0,
        fundingRate: 0,
        sma50: Number(ema50.toFixed(8)),
        priceVsSma50: Number((((price - ema50) / ema50) * 100).toFixed(3)),
        maSignal: bullish ? 'ABOVE' : 'BELOW',
        trustScore: Number(clamp(score * (verified ? 1 : 0.8)).toFixed(1)),
        verified,
        trustBadges,
      };

      return { signal, bullish };
    });

    const cleaned = rows.filter(
      (row): row is NonNullable<typeof row> => row !== null,
    );

    return {
      longs: cleaned
        .filter((row) => row.bullish)
        .map((row) => row.signal)
        .sort((a, b) => b.trustScore - a.trustScore)
        .slice(0, limit),
      shorts: cleaned
        .filter((row) => !row.bullish)
        .map((row) => row.signal)
        .sort((a, b) => b.trustScore - a.trustScore)
        .slice(0, limit),
      scanned: symbols.length,
      duration: Date.now() - started,
      timestamp: new Date().toISOString(),
    };
  }

  async strong(limit = 30): Promise<StrongSignalResult> {
    const result = await this.trendSignals(limit, false);
    return {
      longs: result.longs,
      shorts: result.shorts,
      scanned: result.scanned,
      duration: result.duration,
      timestamp: result.timestamp,
    };
  }

  trusted(limit = 30): Promise<TrustedLongShortResult> {
    return this.trendSignals(limit, true);
  }

  /** Doji candles on the latest 4h close. */
  async doji(limit = 30): Promise<DojiCandlesResult> {
    const started = Date.now();
    const symbols = await this.marketData.getSymbols(120);

    const candles = await this.marketData.mapLimit(symbols, 6, async (symbol) => {
      const data = await this.marketData
        .getCandles(symbol, '4h', 3)
        .catch(() => [] as Candle[]);
      if (data.length < 2) return null;

      const candle = data[data.length - 1];
      const range = candle.high - candle.low;
      const body = Math.abs(candle.close - candle.open);
      const bodyRatio = range > 0 ? body / range : 1;

      // Doji: tiny body inside a meaningful range.
      if (bodyRatio > 0.15 || range <= 0) return null;

      return {
        symbol,
        dojiType: candle.close >= candle.open ? 'BULLISH' : 'BEARISH',
        openTime: candle.time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.quoteVolume,
        bodySize: body,
        range,
        bodyRatio: Number(bodyRatio.toFixed(4)),
      } as DojiCandle;
    });

    const cleaned = candles
      .filter((candle): candle is DojiCandle => candle !== null)
      .sort((a, b) => a.bodyRatio - b.bodyRatio)
      .slice(0, limit);

    return {
      candles: cleaned,
      bullishCount: cleaned.filter((c) => c.dojiType === 'BULLISH').length,
      bearishCount: cleaned.filter((c) => c.dojiType === 'BEARISH').length,
      scanned: symbols.length,
      duration: Date.now() - started,
      timestamp: new Date().toISOString(),
    };
  }

  /** Funding + volume expansion squeeze screen. */
  async fundingVolumeSqueeze(limit = 30): Promise<FundingVolumeSqueezeResult> {
    const started = Date.now();
    const symbols = await this.marketData.getSymbols(100);
    const funding = await this.marketData.getFundingMap();
    const tickers = await this.marketData.getTickerMap();

    const rows = await this.marketData.mapLimit(symbols, 6, async (symbol) => {
      const candles = await this.marketData
        .getCandles(symbol, '1h', 60)
        .catch(() => [] as Candle[]);
      if (candles.length < 30) return null;

      const last = candles[candles.length - 1];
      const avgVolume = candles.slice(-25, -1).reduce((a, c) => a + c.quoteVolume, 0) / 24;
      const volumeRatio = avgVolume > 0 ? last.quoteVolume / avgVolume : 1;
      const rate = funding.get(symbol) ?? 0;
      const priceChange = tickers.get(symbol)?.priceChangePercent ?? 0;

      if (Math.abs(rate) < 0.0004 || volumeRatio < 1.3) return null;

      const trustScore = clamp(
        Math.abs(rate) * 40_000 + Math.min(40, volumeRatio * 10) + Math.abs(priceChange),
      );

      return {
        symbol,
        fundingRate: rate,
        fundingChange: 0,
        volumeRatio: Number(volumeRatio.toFixed(2)),
        priceChange,
        isBullish: rate < 0 ? true : priceChange >= 0,
        trustScore: Number(trustScore.toFixed(1)),
      } as FundingVolumeSqueeze;
    });

    return {
      symbols: rows
        .filter((row): row is FundingVolumeSqueeze => row !== null)
        .sort((a, b) => b.trustScore - a.trustScore)
        .slice(0, limit),
      scanned: symbols.length,
      duration: Date.now() - started,
      timestamp: new Date().toISOString(),
    };
  }

  /** Daily BTC close sequence used by the sequence analysis widget. */
  async btcSequence(limit = 1000): Promise<BTCCandleResult> {
    const size = Math.min(Math.max(limit, 30), 1000);
    const candles = await this.marketData.getCandles('BTCUSDT', '1d', size);

    const raw = candles.map((candle) => ({
      date: new Date(candle.time).toISOString().slice(0, 10),
      close: candle.close,
      value: candle.quoteVolume,
    }));

    return {
      values: raw.map((candle) => candle.close.toFixed(2)),
      raw,
    };
  }

  /** Cluster recent liquidations into price buckets. */
  liquidationClusters(limit = 30): LiquidationClustersResult {
    const started = Date.now();
    const recent = this.liquidationService.getRecentLiquidations(24 * 60 * 60 * 1000);

    const buckets = new Map<string, LiquidationCluster>();

    for (const item of recent) {
      if (item.price <= 0) continue;

      // 0.5% price buckets keep clusters meaningful for every price scale.
      const step = Math.max(item.price * 0.005, 1e-8);
      const bucketPrice = Number(
        (Math.round(item.price / step) * step).toFixed(8),
      );
      const key = `${item.symbol}:${item.side}:${bucketPrice}`;

      const cluster = buckets.get(key) ?? {
        symbol: item.symbol,
        side: item.side,
        priceCluster: bucketPrice,
        priceRange: { min: item.price, max: item.price },
        totalValue: 0,
        totalQuantity: 0,
        liquidationCount: 0,
        liquidations: [],
      };

      cluster.totalValue += item.value;
      cluster.totalQuantity += item.quantity;
      cluster.liquidationCount += 1;
      cluster.priceRange.min = Math.min(cluster.priceRange.min, item.price);
      cluster.priceRange.max = Math.max(cluster.priceRange.max, item.price);
      cluster.liquidations.push(item);

      buckets.set(key, cluster);
    }

    const clusters = [...buckets.values()]
      .sort((a, b) => b.totalValue - a.totalValue)
      .slice(0, limit);

    return {
      exchange: 'BINANCE',
      clusters,
      scanned: new Set(recent.map((item) => item.symbol)).size,
      duration: Date.now() - started,
      timestamp: new Date().toISOString(),
    };
  }

  /** CSV for the current scanner tab. */
  async exportCsv(type: string, limit = 30): Promise<string> {
    const rows: Array<Record<string, unknown>> = [];
    const addRows = (items: object[]) => {
      for (const item of items) rows.push(item as Record<string, unknown>);
    };

    if (type === 'funding-extreme') {
      addRows((await this.fundingExtreme(limit)).symbols);
    } else if (type === 'doji-candles') {
      addRows((await this.doji(limit)).candles);
    } else if (type === 'funding-volume-squeeze') {
      addRows((await this.fundingVolumeSqueeze(limit)).symbols);
    } else if (type === 'liquidation-clusters') {
      addRows(
        this.liquidationClusters(limit).clusters.map((cluster) => ({
          symbol: cluster.symbol,
          side: cluster.side,
          priceCluster: cluster.priceCluster,
          totalValue: cluster.totalValue,
          liquidationCount: cluster.liquidationCount,
        })),
      );
    } else {
      const result = await this.trendSignals(limit, false);
      addRows([...result.longs, ...result.shorts]);
    }

    if (rows.length === 0) return 'symbol,score\n';

    const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    const escape = (value: unknown) => {
      const text = value === null || value === undefined ? '' : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };

    return [
      headers.join(','),
      ...rows.map((row) => headers.map((header) => escape(row[header])).join(',')),
    ].join('\n');
  }
}
